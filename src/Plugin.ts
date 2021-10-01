import { CloudFormation, config as AWSConfig, STS } from "aws-sdk";
import * as fs from "fs";
import * as Path from "path";
import { AWSOptions } from "request";
import * as Request from "request-promise-native";
import * as Serverless from "serverless";
import * as ServerlessPlugin from "serverless/classes/Plugin";
import { promisify } from "util";
import { assumeRole, findCloudformationExport, parseConfigObject } from "./AwsUtils";
import Config, { Index, Template } from "./Config";
import { getProfile, getProviderName, getRegion, getStackName } from "./ServerlessObjUtils";
import { setupRepo } from "./SetupRepo";

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

        const requestOptions: Partial<Request.Options> = {};
        if (serviceName === "aws") {
            const creds = await assumeRole(new STS({ region }), profile);
            AWSConfig.credentials = creds;
            AWSConfig.region = region;
            requestOptions.aws = {
                key: creds.accessKeyId,
                secret: creds.secretAccessKey,
                session: creds.sessionToken,
                sign_version: 4
            } as AWSOptions;
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
            this.serverless.cli.log("Setting up templates...");
            const setupTemplateResult = await setupTemplates(endpoint, config.templates, { cli: this.serverless.cli }, requestOptions);
            console.log("TEMPLATE SETUP RESULT", JSON.stringify(setupTemplateResult, undefined, 2));

            for (const setupTemplate of setupTemplateResult.templates) {
                const { swaps } = setupTemplate;
                for (const swap of swaps) {
                    templateVariables.indices[stripVersion(swap.oldIndex)] = swap.newIndex;
                }
            }

            this.serverless.cli.log("Setting up indices...");
            await setupIndices(endpoint, config.indices, requestOptions);
            this.serverless.cli.log("Setting up repositories...");
            await setupRepo({
                baseUrl: endpoint,
                sts: new STS(),
                repos: config.repositories,
                requestOptions
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
            const cloudFormation = new CloudFormation();

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
function setupIndices(baseUrl: string, indices: Index[] = [], requestOptions?: Partial<Request.Options>) {
    const setupPromises: PromiseLike<Request.FullResponse>[] = indices.map((index) => {
        validateIndex(index);
        const url = `${baseUrl}/${index.name}`;
        const settings = require(Path.resolve(index.file));
        return esPut(url, settings, requestOptions).catch((e) => {
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
async function setupTemplates(baseUrl: string, templates: Template[] = [], opts: SetupTemplatesOptions = {}, requestOptions?: Partial<Request.Options>): Promise<SetupTemplatesReturn> {
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

        if (!!template.shouldSwapIndicesOfAliases) {
            // Retrieving template that already exists.
            const previous = await returnPreviousTemplates(baseUrl, template.name, requestOptions);

            if (!!previous) {
                const { order, ...previousSettings } = previous[template.name];
                if (!deepEqual(previousSettings.mappings, settings.mappings)) {
                    const { aliases } = previousSettings;
                    if (!!aliases) {
                        const aliasNames = Object.keys(aliases);
                        for (const aliasName of aliasNames) {
                           const swapResult = await swapIndicesOfAliases({ cli, aliasName, baseUrl}, requestOptions);
                           returnValue.swaps.push(...swapResult.swaps);
                        }
                    }
                }
            }
        }

        return esPut(url, settings, requestOptions)
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

function returnPreviousTemplates(baseUrl: string, templateName: string, requestOptions?: Partial<Request.Options>): Promise<PreviousTemplate> {
    const url = `${baseUrl}/_template/${templateName}`;
    return esGet(url, undefined, requestOptions)
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

function returnCurrentAliases(baseUrl: string, aliasName: string, requestOptions?: Partial<Request.Options>): Promise<PreviousAliases> {
    const url = `${baseUrl}/_alias/${aliasName}`;
    return esGet(url, undefined, requestOptions)
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

function swapTemplateParameters(template: Template, fileContent: string): string {
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
}

interface SwapIndiciesReturn {
    swaps: {
        alias: string;
        oldIndex: string;
        newIndex: string;
    }[];
}

async function swapIndicesOfAliases(props: SwapIndiciesOfAliasProps, requestOptions?: Partial<Request.Options>): Promise<SwapIndiciesReturn> {
    const { cli = { log: () => {} }, baseUrl, aliasName } = props;
    cli.log(`Retrieving indices for ${aliasName}.`);
    const currentAliases = await returnCurrentAliases(baseUrl, aliasName, requestOptions);

    const returnValue: SwapIndiciesReturn = {
        swaps: []
    };
    const currentIndices = !!currentAliases ? Object.keys(currentAliases) : [];
    for (const currentIndex of currentIndices) {
        const newIndex = incrementVersionValue(currentIndex);
        cli.log(`Reindexing ${currentIndex} to ${newIndex}.`);
        const reindexUrl = `${baseUrl}/_reindex`;
        const reindexBody = {
            source: {
                index: currentIndex
            },
            dest: {
                index: newIndex
            }
        };
        await esPost(reindexUrl, reindexBody, requestOptions);
        cli.log(`Swapping ${currentIndex} to ${newIndex} on alias ${aliasName}.`);

        const aliasSwapUrl = `${baseUrl}/_aliases`;
        const aliasSwapBody = {
            actions: [{
                add: {
                    index: newIndex,
                    alias: aliasName
                }
            }, {
                remove: {
                    index: currentIndex,
                    alias: aliasName
                  }
            }]
        };
        await esPost(aliasSwapUrl, aliasSwapBody, requestOptions);
        returnValue.swaps.push({
            alias: aliasName,
            oldIndex: currentIndex,
            newIndex
        });
    }
    return returnValue;
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

function esGet(url: string, settings: object, requestOpts?: Partial<Request.Options>) {
    return networkCall("get", url, settings, requestOpts);
}

function esPut(url: string, settings: object, requestOpts?: Partial<Request.Options>) {
    return networkCall("put", url, settings, requestOpts);
}

function esPost(url: string, settings: object, requestOpts?: Partial<Request.Options>) {
    return networkCall("post", url, settings, requestOpts);
}

function networkCall(requestFunc: "post" | "put" | "get", url: string, settings: object, requestOpts?: Partial<Request.Options>) {
    const headers = {
        "Content-Type": "application/json",
    };
    return Request[requestFunc](url, {
        headers,
        json: settings,
        ...requestOpts
    });
}

export default Plugin;
