export interface Index {
    name: string;
    file: string;
}

export interface Template {
    name: string;
    file: string;
}

export interface PluginConfig {
    /**
     * The domain endpoint of the elasticsearch server.
     */
    "endpoint"?: string;
    /**
     * The AWS cloudformation output variable that the elasticsearch domain is exported as.
     * If the profile is set in the Serverless file's "provider" section, then that profile must have access to cloudformation outputs.
     * If the profile is not set in the Serverless file, then the "default" profile will be used which have access to cloudformation outputs.
     */
    "cf-endpoint"?: string;
    /**
     * The indices which are to be setup.
     */
    "indices"?: Index[];
    /**
     * The index templates that are to be setup on the server.
     */
    "templates"?: Template[];
}

export default PluginConfig;