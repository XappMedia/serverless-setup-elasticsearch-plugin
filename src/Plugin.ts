import { CLI, Hooks, Serverless, ServerlessPlugin} from "@xapp/serverless-plugin-types";
import { CloudFormation, SharedIniFileCredentials } from "aws-sdk";
import * as AWS4 from "aws4";
import * as Path from "path";
import * as Request from "request-promise-native";
import * as AwsUtils from "./AwsUtils";
import Config, { Index, Template } from "./Config";
import * as ServerlessUtils from "./ServerlessObjUtils";

interface Custom {
    elasticsearch?: Config;
}

class Plugin implements ServerlessPlugin {

    private serverless: Serverless<Custom>;
    private cli: CLI;
    private config: Config;
    hooks: Hooks;

    constructor(serverless: Serverless<Custom>, context: any) {
        this.serverless = serverless;
        this.cli = serverless.cli;

        this.hooks = {
            "before:aws:deploy:deploy:updateStack": this.create.bind(this),
            "after:aws:deploy:deploy:updateStack": this.setupElasticCache.bind(this)
        };
    }

    /**
     * Creates the plugin with the fully parsed Serverless object.
     */
    private async create() {
        const custom = this.serverless.service.custom || {};
        this.config = custom.elasticsearch || {};

        if (!this.config.endpoint && !this.config["cf-endpoint"]) {
            throw new Error("Elasticsearch endpoint not specified.");
        }
    }

    /**
     * Sends the mapping information to elasticsearch.
     */
    private async setupElasticCache() {
        let domain = this.config.endpoint;
        if (this.config["cf-endpoint"]) {
            const cloudFormation = new CloudFormation({
                region: ServerlessUtils.getRegion(this.serverless),
                credentials: new SharedIniFileCredentials({
                    profile: ServerlessUtils.getProfile(this.serverless)
                })
            });
            domain = await AwsUtils.findCloudformationExport(cloudFormation, this.config["cf-endpoint"]);
            if (!domain) {
                throw new Error("Endpoint not found at cloudformation export.");
            }
        }

        const endpoint = domain.startsWith("http") ? domain : `https://${domain}`;

        const signer: Signer = (this.config["aws-profile"]) ?
            awsProfileSigner(domain, this.config["aws-profile"]) :
            doNotingSigner();

        this.cli.log("Setting up templates...");
        await setupTemplates(endpoint, this.config.templates, signer);
        this.cli.log("Setting up indices...");
        await setupIndices(endpoint, this.config.indices, signer);
        this.cli.log("Elasticsearch setup complete.");
    }
}

function doNotingSigner(): Signer {
    return (url, headers) => headers;
}

function awsProfileSigner(domain: string, profile: string): Signer {
    const sharedIni = new SharedIniFileCredentials({ profile });
    return (url, headers) => {
        const pathStart = url.indexOf(domain) + domain.length;
        const path = url.slice(pathStart);
        const opts = {
            host: domain,
            path
        };
        AWS4.sign(opts, { accessKeyId: sharedIni.accessKeyId, secretAccessKey: sharedIni.secretAccessKey });
        return {...headers, opts};
    };
}

/**
 * Sets up all the indices in the given object.
 * @param baseUrl The elasticsearch URL
 * @param indices The indices to set up.
 */
function setupIndices(baseUrl: string, indices: Index[] = [], signer?: Signer) {
    const setupPromises: PromiseLike<Request.FullResponse>[] = indices.map((index) => {
        validateIndex(index);
        const url = `${baseUrl}/${index.name}`;
        const settings = require(Path.resolve(index.file));
        return esPut(url, settings, signer).catch((e) => {
            if (e.error.error.type !== "resource_already_exists_exception") {
                throw e;
            }
        });
    });
    return Promise.all(setupPromises);
}

/**
 * Sets up all the index templates in the given object.
 * @param baseUrl The elasticsearch URL
 * @param templates The templates to set up.
 */
function setupTemplates(baseUrl: string, templates: Template[] = [], signer?: Signer) {
    const setupPromises: PromiseLike<Request.FullResponse>[] = templates.map((template) => {
        validateTemplate(template);
        const url = `${baseUrl}/_template/${template.name}`;
        const settings = require(Path.resolve(template.file));
        return esPut(url, settings, signer);
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

function validateTemplate(template: Template) {
    if (!template.name) {
        throw new Error("Template does not have a name.");
    }
    if (!template.file) {
        throw new Error("Template does not have a file location.");
    }
}

type Signer = (url: string, headers: object) => object;

function esPut(url: string, settings: object, signer: Signer = () => ({})) {
    const headers = {
        "Content-Type": "application/json",
    };
    return Request.put(url, {
        headers: signer(url, headers),
        json: settings
    });
}

export default Plugin;