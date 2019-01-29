import { Serverless } from "serverless-plugin-type-definitions";

export const getProfile = (serverless: Serverless<any>, defaultRegion: string = "default") => getValue(serverless.service.provider, "profile", defaultRegion);

export const getRegion = (serverless: Serverless<any>, defaultRegion?: string) => getValue(serverless.service.provider, "region", defaultRegion);

function getValue<K extends unknown, R>(obj: K, key: keyof K, defaultValue?: R): R {
    return (obj || {} as K)[key] as R || defaultValue;
}