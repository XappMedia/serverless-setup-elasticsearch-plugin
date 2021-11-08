export interface Index {
    name: string;
    file: string;
}

export interface Parameters {
    [key: string]: string;
}

export interface Template {
    name: string;
    file: string;
    /**
     * Automatically swap indices that are currently on the aliases of this template.
     *
     * @type {boolean}
     * @memberof SetupTemplatesOptions
     */
     shouldSwapIndicesOfAliases?: boolean;
     /**
      * Parameters to replace in the template.
      *
      * @type {boolean}
      * @memberof SetupTemplatesOptions
      */
     parameters?: Parameters;
}

export type S3RepositoryType = "s3";

export interface S3RepositorySettings {
    /**
     * The s3 bucket to send backups to.
     */
    bucket: string;
    /**
     * The region that the s3 bucket is in.
     */
    region: string;
    /**
     * The ARN that Elasticsearch will assume to send items.
     * Either this or `role_name` must be set.
     */
    role_arn?: string;
    /**
     * The ARN that Elasticsearch will assume to send items.
     * Either this or `role_arn` must be set.
     */
    role_name?: string;
    /**
     * Whether or not the repository is encrypted on server.
     */
    server_side_encryption?: boolean;
}

export interface IngestionPipeline {
    /**
     * The name of the pipeline.
     *
     * @type {string}
     * @memberof IngestionPipeline
     */
    name: string;
    /**
     * The file location containing the pipeline template.
     *
     * @type {string}
     * @memberof IngestionPipeline
     */
    file: string;
    /**
      * Parameters to replace in the template.
      *
      * @type {boolean}
      * @memberof SetupTemplatesOptions
      */
     parameters?: Parameters;
}

export type RepositoryType = S3RepositoryType | string;
export type RepositorySettings = S3RepositorySettings | object;

export interface Repository {
    name: string;
    type: RepositoryType;
    settings: RepositorySettings;
}

export interface S3Repository extends Repository {
    type: S3RepositoryType;
    settings: S3RepositorySettings;
}

export interface PluginConfig {
    /**
     * The AWS region that must be deploying on to execute. Everything will be skipped if the
     * region being deployed to does not equal this region.
     *
     * @type {string}
     * @memberof PluginConfig
     */
    "onlyOnRegion"?: string;

    /**
     * The domain endpoint of the elasticsearch server.
     *
     * @type {string}
     * @memberof PluginConfig
     */
    "endpoint"?: string;

    /**
     * The AWS cloudformation output variable that the elasticsearch domain is exported as.
     * If the profile is set in the Serverless file's "provider" section, then that profile must have access to cloudformation outputs.
     * If the profile is not set in the Serverless file, then the "default" profile will be used which have access to cloudformation outputs.
     *
     * @type {string}
     * @memberof PluginConfig
     */
    "cf-endpoint"?: string;

    /**
     * The indices which are to be setup.
     *
     * @type {Index[]}
     * @memberof PluginConfig
     */
    "indices"?: Index[];

    /**
     * The index templates that are to be setup on the server.
     *
     * @type {Template[]}
     * @memberof PluginConfig
     */
    "templates"?: Template[];

    /**
     * The repositories to be set for Elasticsearch
     *
     * @type {Repository[]}
     * @memberof PluginConfig
     */
    "repositories"?: Repository[];

    /**
     * The ingestion pipelines in the ES server
     *
     * @type {IngestionPipeline[]}
     * @memberof PluginConfig
     */
    "pipelines"?: IngestionPipeline[];
}

export default PluginConfig;