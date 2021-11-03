import { STS } from "aws-sdk";
import * as Request from "request-promise-native";
import { Repository, S3Repository } from "./Config";
import { esPut, NetworkCredentials } from "./Network";

/**
 * Takes an S3 repository and derives the role_arn from it. It then returns the modified repo.
 * @param repo
 */
export async function discoverRepoArn(sts: STS, repo: S3Repository): Promise<S3Repository> {
    const repoCopy = {...repo };
    if (repo.settings.role_name) {
        // We need to derive the ARN for this repo.
        const accountId = await sts.getCallerIdentity({}).promise().then((result) => result.Account);

        const partition = getPartition(repo.settings.region);
        repoCopy.settings = { ...repoCopy.settings };
        repoCopy.settings.role_arn = `arn:${partition}:iam::${accountId}:role/${repo.settings.role_name}`;
        delete repoCopy.settings.role_name;
    }
    return repoCopy;
}

function getPartition(region: string) {
    if (region.startsWith("cn-")) {
        return "aws-cn";
    }
    if (region.startsWith("us-gov")) {
        return "aws-us-gov";
    }
    return "aws";
}

export interface SetupRepoProps {
    baseUrl: string;
    sts: STS;
    credentials: NetworkCredentials;
    repos?: Repository[];
    requestOptions?: Partial<Request.Options>;
}

/**
 * Sets up all the repos.
 * @param baseUrl
 * @param repo
 */
export function setupRepo(props: SetupRepoProps) {
    const { baseUrl, repos, sts, requestOptions, credentials } = props;
    const setupPromises: PromiseLike<Request.FullResponse>[] = (repos || []).map((repo) => {
        validateRepo(repo);
        const { name } = repo;
        const url = `${baseUrl}/_snapshot/${name}`;
        const modifyRepo = (isS3Repository(repo)) ? discoverRepoArn(sts, repo) : Promise.resolve(repo);
        return modifyRepo.then((repo) => esPut(url, {
            type: repo.type,
            settings: repo.settings
        },
        requestOptions, credentials));
    });
    return Promise.all(setupPromises);
}

function isS3Repository(repo: Repository): repo is S3Repository {
    return repo.type === "s3";
}

function validateRepo(repo: Repository) {
    if (!repo.name) {
        throw new Error("Repo does not have a name.");
    }
    if (!repo.type) {
        throw new Error("Repo does not have a type.");
    }
    // The settings will be validated by Elasticsearch.
}