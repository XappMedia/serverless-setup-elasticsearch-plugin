import * as Serverless from "serverless";

/**
 * Returns the profile that is being use to deploy.  Returns "default" if not provided in the Serverless object.
 * @param serverless The serverless object to search
 * @param defaultProfile The profile to return if the profile was not specified.  Default is "default".
 */
export const getProfile = (serverless: Serverless, defaultProfile: string = "default") => {
    const options: any = (serverless.providers as any)?.aws?.options || {};
    return options.awsProfile || options["aws-profile"]  || defaultProfile;
};

/**
 * Returns the region that the serverless object is deploying in.
 * @param serverless The serverless object to search.
 * @param defaultRegion The default region to return if the region was not specified.
 */
export const getRegion = (serverless: Serverless, defaultRegion?: string) => getValue(serverless.service.provider, ["region"], defaultRegion);

/**
 * Returns the stage that the serverless object is deploying for.
 * @param serverless The serverless object to search.
 * @param defaultStage The default stage to return if the stage was not specified. Default is "dev".
 */
export const getStage = (serverless: Serverless, defaultStage: string = "dev") => getValue(serverless.service.provider, ["stage"], defaultStage);

/**
 * Returns the provider name of the serverles object.
 * @param serverless The serverless object to search.
 * @param defaultName The default stage to return if the stage was not specified.
 */
export const getProviderName = (serverless: Serverless, defaultName?: string) => getValue(serverless.service.provider, ["name"], defaultName);

function getValue<K extends { [key: string]: any }, R>(obj: K, keys: (keyof K)[], defaultValue?: R): R {
    const checkObj = (obj || {}) as any;
    for (const key of keys) {
        // tslint:disable-next-line
        if (checkObj[key] != null) {
            return checkObj[key];
        }
    }
    return defaultValue;
}

/**
 * Returns the stack name of the stack that is deployed or will be deployed.
 * @param serverless
 */
export function getStackName(serverless: Serverless) {
    return `${serverless.service.getServiceName()}-${serverless.service.provider.stage}`;
}