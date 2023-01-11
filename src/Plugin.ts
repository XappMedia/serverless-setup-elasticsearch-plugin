import { CloudFormation, config as AWSConfig, SharedIniFileCredentials, STS } from "aws-sdk";
import * as fs from "fs";
import * as Path from "path";
import * as Request from "request-promise-native";
import * as Serverless from "serverless";
import * as ServerlessPlugin from "serverless/classes/Plugin";
import { promisify } from "util";
import { assumeRole, findCloudformationExport, getServiceUrl, parseConfigObject } from "./AwsUtils";
import Config, { Index, IngestionPipeline, Template } from "./Config";
import { esGet, esPost, esPut, NetworkCredentials } from "./Network";
import { getProfile, getProviderName, getRegion, getStackName } from "./ServerlessObjUtils";
import { setupRepo } from "./SetupRepo";
import { sleep } from "./Sleep";


const readFile = promisify(fs.readFile);
const deepEqual = require("deep-equal");

interface Custom {
    elasticsearch?: Config;
}

class Plugin implements ServerlessPlugin {

    private serverless: Serverless;
    hooks: ServerlessPlugin.Hooks;

    constructor(serverless: Serverless) {
        this.serverless = serverless;

        this.hooks = {
            "before:aws:deploy:deploy:updateStack": this.validate.bind(this),
            "after:aws:deploy:deploy:updateStack": this.setupElasticCache.bind(this)
        };
    }

    /**
     * Creates the plugin with the fully parsed Serverless object.
     */
    private async validate() {
        const custom: Custom = this.serverless.service.custom || {};
        const configs = [].concat(custom.elasticsearch || {});

        for (const config of configs) {
            if (!config.endpoint && !config["cf-endpoint"]) {
                throw new Error("Elasticsearch endpoint not specified.");
            }
        }
    }

    /**
     * Sends the mapping information to elasticsearch.
     */
    private async setupElasticCache() {
        const serviceName = await getProviderName(this.serverless);
        const profile = getProfile(this.serverless);
        const region = getRegion(this.serverless);

        const requestOptions: Partial<Request.Options> = { };
        const credentials: NetworkCredentials = {};
        const sts = new STS({
            credentials: profile ? new SharedIniFileCredentials({ profile }) : undefined,
            region,
            endpoint: getServiceUrl("sts", region)
        });
        if (serviceName === "aws") {
            const creds = await assumeRole(sts, profile);
            AWSConfig.credentials = creds;
            AWSConfig.region = region;
            credentials.accessKeyId = creds.accessKeyId;
            credentials.secretAccessKey = creds.secretAccessKey;
            credentials.sessionToken = creds.sessionToken;
            credentials.region = region;
            credentials.service = "es";
        }

        const configs = await parseConfig(this.serverless);
        const templateVariables: ServerlessVariablesTemplateUpdate = { indices: {} };
        for (const config of configs) {
            if (config.hasOwnProperty("onlyOnRegion") && config.onlyOnRegion !== region) {
                this.serverless.cli.log(`Set to only run on region ${config.onlyOnRegion}, but deploying to region ${region}. Skipping...`);
                continue;
            }
            const endpoint = config.endpoint.startsWith("http") ? config.endpoint : `https://${config.endpoint}`;

            this.serverless.cli.log(`Settings up endpoint ${endpoint}.`);

            this.serverless.cli.log("Setting up ingestion pipelines...");
            await setupIngestionPipelines(endpoint, config.pipelines, requestOptions, credentials);

            this.serverless.cli.log("Setting up templates...");
            const setupTemplateResult = await setupTemplates(endpoint, config.templates, { cli: this.serverless.cli }, requestOptions, credentials);
            for (const setupTemplate of setupTemplateResult.templates) {
                const { swaps } = setupTemplate;
                for (const swap of swaps) {
                    templateVariables.indices[stripVersion(swap.oldIndex)] = swap.newIndex;
                }
            }

            this.serverless.cli.log("Setting up indices...");
            await setupIndices(endpoint, config.indices, requestOptions, credentials);

            this.serverless.cli.log("Setting up repositories...");
            await setupRepo({
                baseUrl: endpoint,
                sts,
                repos: config.repositories,
                requestOptions,
                credentials
            });
        }

        this.serverless.cli.log("Elasticsearch setup complete.");
    }
}

/**
 * Variables related to the template update.
 *
 * @interface ServerlessVariablesTemplateUpdate
 */
interface ServerlessVariablesTemplateUpdate {
    /**
     * The "real name" of the index.  This is the part that starts is before the "_v#" value.
     *
     * So if the index is "MyIndex", the "real name" is "MyIndex".
     *
     * If the index is "MyIndex_v1", the "real name" is "MyIndex".
     *
     * The "key" is the real name.  The value is the name to replace it with.
     *
     * @type {string}
     * @memberof ServerlessVariablesTemplateUpdate
     */
    indices: {
        [name: string]: string;
    };
}

interface ServerlessVariables {
    /**
     * Variables related to the template update.
     *
     * @type {{
     *         index: string;
     *     }}
     * @memberof ServerlessVariables
     */
    template: ServerlessVariablesTemplateUpdate;
}

/**
 * Replaces variables in the serverless object.  A variable must start with `{{esSetup`.
 *
 * The remaining variable is the name of the ServerlessVariable and a name to replace.
 *
 * For example
 *
 * {{esSetup.template.indices: index1}}
 *
 * Corresponds to the value:
 *
 * {
 *    template: {
 *       indices: {
 *           index1: <Value to replace the variable>
 *       }
 *    }
 * }
 *
 * @export
 * @template OBJ
 * @param {ServerlessVariables} serverlessVariables
 * @param {OBJ} objToReplace
 * @returns {OBJ}
 */
export function replaceServerlessTemplates<OBJ>(serverlessVariables: ServerlessVariables, objToReplace: OBJ): OBJ {
    const keyRegex = /{{esSetup\.([a-z._\-0-9]+):([ a-z0-9]+)}}/;
    if (typeof objToReplace === "string") {
        const match = objToReplace.match(keyRegex);
        if (!!match) {
            const variableName = match[1];
            const variableValue = match[2];
            const serverlessVariableKeys = `${variableName}.${variableValue}`.split(".").map(s => s.trim());
            let serverlessVariableValue: any = serverlessVariables;
            let wasSet: boolean = false; // Need to keep track if the user explicitly set the value.
            for (const key of serverlessVariableKeys) {
                wasSet = serverlessVariableValue.hasOwnProperty(key);
                if (wasSet) {
                    serverlessVariableValue = serverlessVariableValue[key];
                }
            }
            // The OBJ to be returned is of type "string", but Typescript doesn't see it that way.
            return wasSet ? objToReplace.replace(match[0], serverlessVariableValue) as any : objToReplace;
        }
    } else if (Array.isArray(objToReplace)) {
        // We know "OBJ" is an array because of the check but Typescript is unhappy with that.
        for (let i = 0; i < objToReplace.length; ++i) {
            objToReplace[i] = replaceServerlessTemplates(serverlessVariables, objToReplace[i]);
        }
    } else if (typeof objToReplace === "object") {
        const serverlessKeys = Object.keys(objToReplace || {}) as (keyof OBJ)[];
        for (const serverlessKey of serverlessKeys) {
            objToReplace[serverlessKey] = replaceServerlessTemplates(serverlessVariables, objToReplace[serverlessKey]);
        }
    }
    return objToReplace;
}

/**
 * Parses the config object so all attributes are usable values.
 *
 * If the user has defined "cf-Endpoint" then the correct value will be moved to "endpoint".
 *
 * @param serverless
 */
async function parseConfig(serverless: Serverless): Promise<Config[]> {
    const provider = serverless.service.provider;
    const custom: Custom = serverless.service.custom || {};
    let configs = [].concat(custom.elasticsearch || {} as Config);

    const returnConfigs: Config[] = [];
    for (const config of configs) {
        if (config.hasOwnProperty("onlyOnRegion") && config.onlyOnRegion !== getRegion(serverless)) {
            continue;
        }
        if (provider.name === "aws" || config["cf-endpoint"]) {
            const proifle = getProfile(serverless);
            const cloudFormation = new CloudFormation({
                credentials: proifle ? new SharedIniFileCredentials({ profile: getProfile(serverless) }) : undefined,
                endpoint: getServiceUrl("cloudformation", getRegion(serverless))
            });

            const newConfig: Config = await parseConfigObject(cloudFormation, getStackName(serverless), config);

            if (newConfig["cf-endpoint"]) {
                newConfig.endpoint = await findCloudformationExport(cloudFormation, config["cf-endpoint"]);
                if (!newConfig.endpoint) {
                    throw new Error("Endpoint not found at cloudformation export.");
                }
            }
            returnConfigs.push(newConfig);
        }
    }
    return returnConfigs;
}

/**
 * Sets up all the indices in the given object.
 * @param baseUrl The elasticsearch URL
 * @param indices The indices to set up.
 */
function setupIndices(baseUrl: string, indices: Index[] = [], requestOptions: Partial<Request.Options>, credentials: NetworkCredentials) {
    const setupPromises: PromiseLike<Request.FullResponse>[] = indices.map((index) => {
        validateIndex(index);
        const url = `${baseUrl}/${index.name}`;
        const settings = require(Path.resolve(index.file));
        return esPut(url, settings, requestOptions, credentials).catch((e) => {
            if (e.error.error.type !== "resource_already_exists_exception") {
                throw e;
            }
        });
    });
    return Promise.all(setupPromises);
}

function validateIndex(index: Index) {
    if (!index.name) {
        throw new Error("Index does not have a name.");
    }
    if (!index.file) {
        throw new Error("Index does not have a file location.");
    }
}

interface SetupTemplatesOptions {
    cli?: { log: (message: string) => any };
}

type SetupTemplatesResult = Template & {
    swaps: {
        alias: string;
        oldIndex: string;
        newIndex: string;
    }[];
};

interface SetupTemplatesReturn {
    templates: SetupTemplatesResult[];
}

/**
 * Sets up all the index templates in the given object.
 * @param baseUrl The elasticsearch URL
 * @param templates The templates to set up.
 */
async function setupTemplates(baseUrl: string, templates: Template[] = [], opts: SetupTemplatesOptions = {}, requestOptions: Partial<Request.Options>, credentials: NetworkCredentials): Promise<SetupTemplatesReturn> {
    const { cli = { log: () => {} } } = opts;
    const setupPromises: PromiseLike<SetupTemplatesResult>[] = templates.map(async (template): Promise<SetupTemplatesResult> => {
        validateTemplate(template);

        const url = `${baseUrl}/_template/${template.name}`;

        const file = await readFile(Path.resolve(template.file)).then((file) => file.toString("utf-8"));
        const settings = JSON.parse(swapTemplateParameters(template, file));

        const returnValue: SetupTemplatesResult = {
            ...template,
            swaps: []
        };

        const { shouldSwapIndicesOfAliases } = template;
        if (!!template.shouldSwapIndicesOfAliases) {
            const reIndexPipeline = typeof shouldSwapIndicesOfAliases === "object" ? shouldSwapIndicesOfAliases.reIndexPipeline : undefined;
            // Retrieving template that already exists.
            const previous = await returnPreviousTemplates(baseUrl, template.name, requestOptions, credentials);

            if (!!previous) {
                const { order, ...previousSettings } = previous[template.name];
                if (!deepEqual(previousSettings.mappings, settings.mappings)) {
                    const { aliases } = previousSettings;
                    if (!!aliases) {
                        const aliasNames = Object.keys(aliases);
                        for (const aliasName of aliasNames) {
                           const swapResult = await swapIndicesOfAliases({ cli, aliasName, baseUrl, reIndexPipeline }, requestOptions, credentials);
                           returnValue.swaps.push(...swapResult.swaps);
                        }
                    }
                }
            }
        }

        return esPut(url, settings, requestOptions, credentials)
            .then(() => returnValue);
    });
    return Promise.all(setupPromises)
        .then((results) => results.reduce((returnValue: SetupTemplatesReturn, current) => {
            returnValue.templates.push(current);
            return returnValue;
        }, { templates: [] }));
}

interface PreviousTemplateAttributes {
    order: number;
    index_patterns?: string[];
    settings: {
        index: {
            analysis: {
                filter?: { [filterName: string]: any };
                analyzer: { [analyzerName: string]: any };
            }
        }
    };
    mappings: {
        dynamic_templates?: {
            [dynamicTemplateName: string]: {
                mapping: {
                    type: string,
                    fields: { [ fieldName: string]: any }
                },
                match_mapping_type: string
            }
        };
        properties: {
            [propertyName: string]: any;
        }
    };
    aliases?: {
        [aliasName: string]: any
    };
}

interface PreviousTemplate {
    [templateName: string]: PreviousTemplateAttributes;
}

function returnPreviousTemplates(baseUrl: string, templateName: string, requestOptions: Partial<Request.Options>, credentials: NetworkCredentials): Promise<PreviousTemplate> {
    const url = `${baseUrl}/_template/${templateName}`;
    return esGet(url, undefined, requestOptions, credentials)
        .then(result => JSON.parse(result))
        .catch((error) => {
            if (error.statusCode === 404) {
                return undefined;
            }
            throw error;
        });
}

interface PreviousAliases {
    [indexName: string]: {
        [aliasName: string]: any;
    };
}

function returnCurrentAliases(baseUrl: string, aliasName: string, requestOptions: Partial<Request.Options>, credentials: NetworkCredentials): Promise<PreviousAliases> {
    const url = `${baseUrl}/_alias/${aliasName}`;
    return esGet(url, undefined, requestOptions, credentials)
        .then(result => JSON.parse(result))
        .catch((error) => {
            if (error.statusCode === 404) {
                return undefined;
            }
            throw error;
        });
}

function validateTemplate(template: Template) {
    if (!template.name) {
        throw new Error("Template does not have a name.");
    }
    if (!template.file) {
        throw new Error("Template does not have a file location.");
    }
}

function swapTemplateParameters(template: Template | IngestionPipeline, fileContent: string): string {
    const { parameters = {} } = template;
    let replacedContent = fileContent;
    for (const paramKey of Object.keys(parameters)) {
        const regex = new RegExp(`\\\${${paramKey}}`, "g");
        replacedContent = replacedContent.replace(regex, parameters[paramKey]);
    }
    return replacedContent;
}

interface SwapIndiciesOfAliasProps {
    cli?: { log(message: string): any };
    baseUrl: string;
    aliasName: string;
    reIndexPipeline?: string;
}

interface SwapIndiciesReturn {
    swaps: {
        alias: string;
        oldIndex: string;
        newIndex: string;
    }[];
}

async function swapIndicesOfAliases(props: SwapIndiciesOfAliasProps, requestOptions: Partial<Request.Options>, credentials: NetworkCredentials): Promise<SwapIndiciesReturn> {
    const { cli = { log: () => {} }, baseUrl, aliasName } = props;
    cli.log(`Retrieving indices for ${aliasName}.`);
    const currentAliases = await returnCurrentAliases(baseUrl, aliasName, requestOptions, credentials);

    const returnValue: SwapIndiciesReturn = {
        swaps: []
    };
    const currentIndices = !!currentAliases ? Object.keys(currentAliases) : [];
    for (const currentIndex of currentIndices) {
        const newIndex = incrementVersionValue(currentIndex);
        cli.log(`Creating index ${newIndex}.`);
        const createIndexUrl = `${baseUrl}/${newIndex}`;
        await esPut(createIndexUrl, {}, requestOptions, credentials)
            .catch((error) => {
                cli.log(`Failed to create index ${newIndex}: ${error.message}`);
                throw error;
            });

        cli.log(`Reindexing ${currentIndex} to ${newIndex}.`);
        const reindexUrl = `${baseUrl}/_reindex?wait_for_completion=false`;
        const reindexBody = {
            source: {
                index: currentIndex
            },
            dest: {
                index: newIndex,
                pipeline: props.reIndexPipeline
            }
        };
        const response = await esPost(reindexUrl, reindexBody, requestOptions, credentials)
            .catch((error) => {
                cli.log(`Failed to reindex ${currentIndex} to ${newIndex}: ${error.message}`);
                throw error;
            });
        const reindexTaskToken: string = response.task;
        cli.log("Waiting for reindex task to complete.");
        await waitForTaskCompletion({
            baseUrl,
            cli,
            taskId: reindexTaskToken,
        }, requestOptions, credentials);

        cli.log(`Swapping ${currentIndex} to ${newIndex} on alias ${aliasName}.`);

        const aliasSwapUrl = `${baseUrl}/_aliases`;
        const aliasSwapBody = {
            actions: [{
                // Make the current index an alias to the new index with the same name so code that calls it will keep it.
                add: {
                    index: newIndex,
                    alias: stripVersion(currentIndex)
                }
            },
              // Point the alias to the new index.
            {
                add: {
                    index: newIndex,
                    alias: aliasName
                }
            },
                // Remove the old index
                {
                remove_index: {
                    index: currentIndex
                  }
            }]
        };
        await esPost(aliasSwapUrl, aliasSwapBody, requestOptions, credentials)
            .catch((e) => {
                cli.log(`Failed to swap indices: ${e.message}`);
                throw e;
            });

        returnValue.swaps.push({
            alias: aliasName,
            oldIndex: currentIndex,
            newIndex
        });
    }
    return returnValue;
}

interface WaitTaskCompletionProps {
    baseUrl: string;
    taskId: string;
    cli: { log(message: string): any };
}

async function waitForTaskCompletion(props: WaitTaskCompletionProps, requestOptions: Partial<Request.Options>, credentials: NetworkCredentials) {
    const { baseUrl, taskId, cli } = props;
    // For some reason, /_tasks/{taskId} returns a 403 on some servers, so we're going to
    // pull all the tasks and look for the one we want.
    let sleepTime = 15;
    const url = `${baseUrl}/_tasks`;
    const nodeAndTask = taskId.split(":");
    const task = await esGet(url, undefined, requestOptions, credentials)
        .then(result => JSON.parse(result))
        .then(tasks => tasks.nodes[nodeAndTask[0]].tasks[taskId])
        .catch((e) => {
            if (e.statusCode === 404) {
                return { completed: true };
            }
            if (e.statusCode === 429) { // Too many requests  Slow it down a bit.
                sleepTime = 60 * 5;
            }
            throw e;
        });
    if (!task || task.completed) {
        return;
    }

    cli.log(`Waiting for task ${taskId} to complete.`);
    await sleep(sleepTime);

    await waitForTaskCompletion(props, requestOptions, credentials);
}

export function incrementVersionValue(value: string) {
    const versionRegex = /(.+)(_v(\d+)?)/;
    const matches = value.match(versionRegex);
    const name = !!matches ? matches[1] : value;
    const versionNumber = !!matches && !Number.isNaN(Number.parseInt(matches[3])) ? Number.parseInt(matches[3]) : 0;
    return `${name}_v${versionNumber + 1}`;
}

export function stripVersion(value: string) {
    const versionRegex = /(.+)(_v(\d+)?)/;
    const matches = value.match(versionRegex);
    return !!matches ? matches[1] : value;
}

export interface SetupIngestionPipelineResult {

}

async function setupIngestionPipelines(baseUrl: string, templates: IngestionPipeline[] = [], requestOptions: Partial<Request.Options>, credentials: NetworkCredentials): Promise<SetupIngestionPipelineResult> {
    const setupPromises: PromiseLike<SetupIngestionPipelineResult>[] = templates.map(async (template): Promise<SetupTemplatesResult> => {
        validateIngestionPipelineTemplate(template);

        const url = `${baseUrl}/_ingest/pipeline/${template.name}`;

        const file = await readFile(Path.resolve(template.file)).then((file) => file.toString("utf-8"));
        const settings = JSON.parse(swapTemplateParameters(template, file));

        return esPut(url, settings, requestOptions, credentials);
    });
    return Promise.all(setupPromises);
}

function validateIngestionPipelineTemplate(template: IngestionPipeline) {
    if (!template.name) {
        throw new Error("Ingestion pipeline template does not have a name.");
    }
    if (!template.file) {
        throw new Error("Ingestion pipeline template does not have a file location.");
    }
}


export default Plugin;
