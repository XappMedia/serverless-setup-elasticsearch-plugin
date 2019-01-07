import { CloudFormation } from "aws-sdk";

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
