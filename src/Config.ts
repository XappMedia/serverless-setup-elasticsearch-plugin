export interface Index {
    name: string;
    file: string;
}

export interface Template {
    name: string;
    file: string;
}

export type S3RepositoryType = "s3";

export interface S3RepositorySettings {
    bucket: string;
    region: string;
    role_arn: string;
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

    /**
     * The AWS Profile credentials that is to be used to send information to the Elasticsearch server.
     */
    "aws-profile"?: string;
}

export default PluginConfig;