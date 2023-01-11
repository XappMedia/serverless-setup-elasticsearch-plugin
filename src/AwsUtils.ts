import { CloudFormation, Credentials, SharedIniFileCredentials, STS } from "aws-sdk";
import FeatureNotSupportedError from "./FeatureNotSupportedError";
import ResourceNotFoundError from "./ResourceNotFoundError";

export function getServiceUrl(service: string, region: string): string {
    return `${service}.${region}.amazonaws.com`;
}

/**
 * Retrieves credentials which can be used to sign requests.
 *
 * @export
 * @param {STS} sts
 * @param {string} profile AWS profile name to assume.
 * @returns {(Promise<Pick<Credentials, "accessKeyId" | "secretAccessKey" | "sessionToken">>)}
 */
export async function assumeRole(sts: STS, profile: string): Promise<Pick<Credentials, "accessKeyId" | "secretAccessKey" | "sessionToken">> {
    const creds = profile ? new SharedIniFileCredentials({  profile, }) : undefined;
    if (profile && (!creds.accessKeyId || !creds.secretAccessKey)) {
        const data = await sts.assumeRole({
            // @ts-ignore
            RoleArn: creds.roleArn,
            RoleSessionName: "elastic-plugin"
        }).promise();
        return {
            accessKeyId: data.Credentials.AccessKeyId,
            secretAccessKey: data.Credentials.SecretAccessKey,
            sessionToken: data.Credentials.SessionToken
        };
    }
    return Promise.resolve(creds);
}

/**
 * Returns the value of the CloudFormation exported item.
 * @param cf The CloudFormation object to use.
 * @param exportName The name of the exported item.
 */
export function findCloudformationExport(cf: CloudFormation, exportName: string): Promise<string> {
    const find = (NextToken?: string): Promise<string> => {
        return cf.listExports({ NextToken }).promise()
            .then((results): string | Promise<string> => {
                const item = results.Exports.find((cfExport) => cfExport.Name === exportName);
                return (item) ? item.Value : (results.NextToken) ? find(results.NextToken) : undefined;
            });
    };
    return find();
}

export interface ConfigObject {
    [key: string]: any | CloudFormationObject;
}

/**
 * Will recursively filter through a configuration object and look for CloudFormation items to parse
 * like "Ref:" and "Fn::*" functions.
 * @param cf
 * @param stackName
 * @param configObject
 */
export async function parseConfigObject(cf: CloudFormation, stackName: string, configObject: any | ConfigObject) {
    if (isNotDefined(configObject)) {
        return configObject;
    }
    if (typeof configObject !== "object") {
        return configObject;
    }
    const keys = Object.keys(configObject);
    const newObject: ConfigObject = Array.isArray(configObject) ? configObject.slice() : { ...configObject };
    for (const key of keys) {
        const item = configObject[key];
        if (!isNotDefined(item)) {
            if (Array.isArray(item)) {
                newObject[key] = await parseConfigObject(cf, stackName, item);
            } else if (typeof item === "object") {
                const internalObjectKeys = Object.keys(item);
                if (internalObjectKeys.length === 1 && cloudFormationObjectKeys.indexOf(internalObjectKeys[0] as keyof CloudFormationObject) >= 0) {
                    // Possibly a Cloudformation object like Ref or Fn::*
                    newObject[key] = await retrieveCloudFormationValue(cf, stackName, item);
                } else {
                    newObject[key] = await parseConfigObject(cf, stackName, item);
                }
            } // Else it's already what it should be.
        }
    }
    return newObject;
}

const cloudFormationObjectKeys: (keyof CloudFormationObject)[] = Object.keys({
    Ref: ""
} as Required<CloudFormationObject>) as (keyof CloudFormationObject)[];

export interface CloudFormationObject {
    Ref?: string;
}

export function retrieveCloudFormationValue(cf: CloudFormation, stackName: string, value: CloudFormationObject): Promise<boolean | number | string> {
    if (isNotDefined(value)) {
        return Promise.resolve(value as string); // It's undefined but Typescript doesn't know or care so we're just going to lie.
    }
    if (typeof value !== "object" || Object.keys(value).length !== 1) {
        return Promise.reject(new Error("Value is not a CloudFormation parsable object."));
    }
    if (!isNotDefined(value.Ref)) {
        return findPhysicalID(cf, stackName, value.Ref);
    }
    return Promise.reject(new FeatureNotSupportedError(`CloudFormation value ${Object.keys(value)[0]} not currently supported.`));
}

/**
 * Returns the *physical ID* of a resource in a stack from the given ref.
 *
 * Throws an error if the ID is not found at the stack.
 * @param cf
 * @param stackName
 * @param ref
 */
export function findPhysicalID(cf: CloudFormation, stackName: string, ref: string): Promise<string> {
    const find = (NextToken?: string): Promise<string> => {
        return cf.listStackResources({ StackName: stackName, NextToken }).promise()
            .then((results): string | Promise<string> => {
                const item = results.StackResourceSummaries.find(resource => resource.LogicalResourceId === ref);
                return (item) ? item.PhysicalResourceId : (results.NextToken) ? find(results.NextToken) : undefined;
            });
    };
    return find()
        .then((physicalId) => {
            if (isNotDefined(physicalId)) {
                throw new ResourceNotFoundError(`Physical ID not found for ref "${ref}" in stack "${stackName}".`);
            }
            return physicalId;
        });
}

function isNotDefined(item: any) {
    // tslint:disable:no-null-keyword Checking for null with double equals checks both undefined and null
    return item == null;
    // tslint:enable:no-null-keyword
}