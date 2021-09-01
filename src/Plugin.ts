import { CloudFormation, config as AWSConfig, STS } from "aws-sdk";
import * as Path from "path";
import { AWSOptions } from "request";
import * as Request from "request-promise-native";
import * as Serverless from "serverless";
import * as ServerlessPlugin from "serverless/classes/Plugin";
import { assumeRole, findCloudformationExport, parseConfigObject } from "./AwsUtils";
import Config, { Index, Template } from "./Config";
import { getProfile, getProviderName, getRegion, getStackName } from "./ServerlessObjUtils";
import { setupRepo } from "./SetupRepo";

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

        console.log("PARSING CONFIG");
        const configs = await parseConfig(this.serverless);
        console.log("CONFIG PARSED");
        for (const config of configs) {
            const endpoint = config.endpoint.startsWith("http") ? config.endpoint : `https://${config.endpoint}`;

            this.serverless.cli.log(`Settings up endpoint ${endpoint}.`);
            this.serverless.cli.log("Setting up templates...");
            const setupTemplateResult = await setupTemplates(endpoint, config.templates, { cli: this.serverless.cli }, requestOptions);
            console.log("TEMPLATE SETUP RESULT", JSON.stringify(setupTemplateResult, undefined, 2));
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

interface SetupTemplatesReturn {
    swaps: {
        alias: string;
        oldIndex: string;
        newIndex: string;
    }[];
}

/**
 * Sets up all the index templates in the given object.
 * @param baseUrl The elasticsearch URL
 * @param templates The templates to set up.
 */
async function setupTemplates(baseUrl: string, templates: Template[] = [], opts: SetupTemplatesOptions = {}, requestOptions?: Partial<Request.Options>): Promise<SetupTemplatesReturn> {
    const { cli = { log: () => {} } } = opts;
    const setupPromises: PromiseLike<SetupTemplatesReturn>[] = templates.map(async (template): Promise<SetupTemplatesReturn> => {
        validateTemplate(template);
        const url = `${baseUrl}/_template/${template.name}`;

        const settings = require(Path.resolve(template.file));

        const returnValue: SetupTemplatesReturn = {
            swaps: []
        };

        if (!!template.shouldSwapIndicesOfAliases) {
            // Retrieving template that already exists.
            const previous = await esGet(url, undefined, requestOptions)
                .then(result => JSON.parse(result))
                .catch((error) => {
                    if (error.statusCode === 404) {
                        return undefined;
                    }
                    throw error;
                });

            if (!!previous) {
                const { order, ...previousSettings } = previous[template.name];
                if (!deepEqual(previousSettings.mappings, settings.mappings)) {
                    console.log("PREVIOUS", JSON.stringify(previous, undefined, 2));
                    const { aliases } = previousSettings;
                    if (!!aliases) {
                        console.log("ALIASES", JSON.stringify(aliases, undefined, 2));
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
            returnValue.swaps.push(...current.swaps);
            return returnValue;
        }, { swaps: [] }));
}

function validateTemplate(template: Template) {
    if (!template.name) {
        throw new Error("Template does not have a name.");
    }
    if (!template.file) {
        throw new Error("Template does not have a file location.");
    }
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
    const aliasesUrl = `${baseUrl}/_alias/${aliasName}`;
    cli.log(`Retrieving indices for ${aliasName}.`);
    const currentAliases = await esGet(aliasesUrl, undefined, requestOptions)
        .then(result => JSON.parse(result))
        .catch((error) => {
            if (error.statusCode === 404) {
                return undefined;
            }
            throw error;
        });

    const returnValue: SwapIndiciesReturn = {
        swaps: []
    };
    const currentIndices = Object.keys(currentAliases);
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
    console.log("SWAPS", JSON.stringify(returnValue, undefined, 2));
    return returnValue;
}

export function incrementVersionValue(value: string) {
    const versionRegex = /(.+)(_v(\d+)?)/;
    const matches = value.match(versionRegex);
    const name = !!matches ? matches[1] : value;
    const versionNumber = !!matches && !Number.isNaN(Number.parseInt(matches[3])) ? Number.parseInt(matches[3]) : 0;
    return `${name}_v${versionNumber + 1}`;
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
