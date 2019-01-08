import Serverless from "./Serverless";

export const getProfile = (serverless: Serverless<any>) => getValue(serverless.service.provider, "profile", "default");

export const getRegion = (serverless: Serverless<any>, defaultRegion?: string) => getValue(serverless.service.provider, "region", defaultRegion);

function getValue<K extends unknown, R>(obj: K, key: keyof K, defaultValue?: R): R {
    return (obj || {} as K)[key] as R || defaultValue;
}