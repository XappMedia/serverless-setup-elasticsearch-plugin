export interface Index {
    name: string;
    file: string;
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

    /**
     * The repositories to be set for Elasticsearch
     */
    "repositories"?: Repository[];
}

export default PluginConfig;