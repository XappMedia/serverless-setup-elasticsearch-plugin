import * as Chai from "chai";
import * as path from "path";
import * as Request from "request-promise-native";
import * as Serverless from "serverless";
import * as ServerlessPlugin from "serverless/classes/Plugin";
import * as Sinon from "sinon";
import * as SinonChai from "sinon-chai";
import * as AwsUtils from "../src/AwsUtils";
import Config, { Index, Repository, Template } from "../src/Config";
import Plugin from "../src/Plugin";

Chai.use(SinonChai);
const expect = Chai.expect;

const fakeServerless: any = {
    service: {
        getServiceName: () => "TestService",
        provider: {
            name: "aws"
        }
    },
    cli: {
        log: Sinon.stub()
    }
};

const endpointConfig: Config = {
    endpoint: "ABCD123"
};

describe("Plugin", () => {
    let findCloudformationExportStub: Sinon.SinonStub;
    let putStub: Sinon.SinonStub;

    before(() => {
        putStub = Sinon.stub(Request, "put");
        findCloudformationExportStub = Sinon.stub(AwsUtils, "findCloudformationExport");
    });

    beforeEach(() => {
        putStub.resetHistory();
        putStub.resetBehavior();
        putStub.returns(Promise.resolve());

        findCloudformationExportStub.resetHistory();
        findCloudformationExportStub.resetBehavior();
        findCloudformationExportStub.returns(Promise.resolve(endpointConfig.endpoint));
    });

    after(() => {
        putStub.restore();
    });

    describe("Create", () => {
        it("Tests that an error is thrown if there is no domain.", async () => {
            const serverless = { ...fakeServerless };
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await checkAndCatchError(
                () => plugin.hooks["before:aws:deploy:deploy:updateStack"](),
                "Elasticsearch endpoint not specified."
            );
        });
    });

    describe("Setup indices", () => {
        function createServerless(indices: Index[]): Serverless {
            return {
                ...fakeServerless,
                service: {
                    ...fakeServerless.service,
                    custom: {
                        elasticsearch: {
                            ...endpointConfig,
                            indices
                        }
                    }
                }
            };
        }

        it("Tests that an error is through if there is a cf-endpoint and it does not have an endpoint", async () => {
            const serverless = {
                ...fakeServerless,
                service: {
                    ...fakeServerless.service,
                    custom: {
                        elasticsearch: {
                            "cf-endpoint": "TestCfEndpoint"
                        }
                    }
                }
            };

            findCloudformationExportStub.returns(Promise.resolve(undefined));
            const plugin: ServerlessPlugin = new Plugin(serverless);

            plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"](), "Endpoint not found at cloudformation export.");
        });

        it("Tests that https is pre-pended to the url if it does not exist.", async () => {
            const serverless = createServerless([
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ]);
            serverless.service.custom.elasticsearch.endpoint = "TestCfEndpoint";

            const plugin: Plugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://TestCfEndpoint/Index1");
        });

        it("Tests that https is pre-pended to the url if it does not exist from a cloudformation domain.", async () => {
            const serverless = createServerless([
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ]);
            serverless.service.custom.elasticsearch.endpoint = undefined;
            serverless.service.custom.elasticsearch["cf-endpoint"] = "ABCD123";

            findCloudformationExportStub.returns(Promise.resolve("TestCfEndpoint"));
            const plugin: Plugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://TestCfEndpoint/Index1");
        });

        it("Tests that the url is not touched if it already has https.", async () => {
            const serverless = createServerless([
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ]);
            serverless.service.custom.elasticsearch.endpoint = "https://TestCfEndpoint";
            const plugin: Plugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://TestCfEndpoint/Index1");
        });

        it("Tests that an error is thrown if a name is not provided for index.", async () => {
            const indices: Index[] = [
                {
                    name: undefined,
                    file: "./test/testFiles/TestIndices1.json"
                }
            ];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that an error is thrown if a file location is not provided for index.", async () => {
            const indices: Index[] = [
                {
                    name: "Index1",
                    file: undefined
                }
            ];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that a single index is sent to the server url.", async () => {
            const indices: Index[] = [
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const index1 = require(path.resolve(indices[0].file));

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://ABCD123/Index1", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: index1
            });
        });

        it("Tests that the error 'resource_already_exists' is left alone.", async () => {
            const indices: Index[] = [
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const index1 = require(path.resolve(indices[0].file));

            putStub.callsFake(() => Promise.reject(new RequestError("The resource could not be made.", "resource_already_exists_exception")));

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            // No error.
            expect(putStub).to.have.been.calledWith("https://ABCD123/Index1", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: index1
            });
        });

        it("Tests that any error is thrown to the top.", async () => {
            const indices: Index[] = [
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            putStub.callsFake(() => Promise.reject(new RequestError("The resource could not be made.", "Some random error")));

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that multiple indices is sent to the server url.", async () => {
            const indices: Index[] = [
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                },
                {
                    name: "Index2",
                    file: "./test/testFiles/TestIndices2.json"
                }
            ];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const index1 = require(path.resolve(indices[0].file));
            const index2 = require(path.resolve(indices[1].file));

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://ABCD123/Index1", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: index1
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/Index2", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: index2
            });
        });
    });

    describe("Setup Templates", () => {
        function createServerless(templates: Template[]): Serverless {
            return {
                ...fakeServerless,
                service: {
                    ...fakeServerless.service,
                    custom: {
                        elasticsearch: {
                            ...endpointConfig,
                            templates
                        }
                    }
                }
            };
        }

        it("Tests that a template without a name throws an error.", async () => {
            const templates: Template[] = [{
                name: undefined,
                file: "./test/testFiles/TestTemplate1.json"
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that a template without a file throws an error.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: undefined
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that a single template is sent.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json"
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            const template1 = require(path.resolve(templates[0].file));

            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate1", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: template1
            });
        });

        it("Tests that a multiple templates are sent.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json"
            }, {
                name: "TestTemplate2",
                file: "./test/testFiles/TestTemplate2.json"
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            const template1 = require(path.resolve(templates[0].file));
            const template2 = require(path.resolve(templates[1].file));

            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate1", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: template1
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate2", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: template2
            });
        });
    });

    describe("Setup Repo", () => {
        function createServerless(repositories: Repository[]): Serverless {
            return {
                ...fakeServerless,
                service: {
                    ...fakeServerless.service,
                    custom: {
                        elasticsearch: {
                            ...endpointConfig,
                            repositories
                        }
                    }
                }
            };
        }

        it("Tests that a repo without a name throws an error.", async () => {
            const repos: Repository[] = [{
                name: undefined,
                type: "s3",
                settings: {
                    bucket: "TestBucket",
                    region: "us-east-1",
                    role_arn: "MyArn"
                }
            }];

            const serverless = createServerless(repos);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that a repo without a type throws an error.", async () => {
            const repos: Repository[] = [{
                name: "TestRepo",
                type: undefined,
                settings: {
                    bucket: "TestBucket",
                    region: "us-east-1",
                    role_arn: "MyArn"
                }
            }];

            const serverless = createServerless(repos);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that a single repo is sent.", async () => {
            const repos: Repository[] = [{
                name: "TestRepo",
                type: "s3",
                settings: {
                    bucket: "TestBucket",
                    region: "us-east-1",
                    role_arn: "MyArn"
                }
            }];

            const serverless = createServerless(repos);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://ABCD123/_snapshot/TestRepo", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: {
                    type: repos[0].type,
                    settings: repos[0].settings
                }
            });
        });

        it("Tests that multiple repos are sent.", async () => {
            const repos: Repository[] = [{
                name: "TestRepo1",
                type: "s3",
                settings: {
                    bucket: "TestBucket",
                    region: "us-east-1",
                    role_arn: "MyArn"
                }
            }, {
                name: "TestRepo2",
                type: "s3",
                settings: {
                    bucket: "TestBucket2",
                    region: "us-east-2",
                    role_arn: "MyArn2"
                }
            }];

            const serverless = createServerless(repos);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://ABCD123/_snapshot/TestRepo1", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: {
                    type: repos[0].type,
                    settings: repos[0].settings
                }
            });

            expect(putStub).to.have.been.calledWith("https://ABCD123/_snapshot/TestRepo2", {
                headers: {
                    "Content-Type": "application/json"
                },
                json: {
                    type: repos[1].type,
                    settings: repos[1].settings
                }
            });
        });
    });
});

async function checkAndCatchError(callback: () => any, msg?: string): Promise<void> {
    let caughtError: Error;
    try {
        await Promise.resolve().then(callback);
    } catch (e) {
        caughtError = e;
    }
    expect(caughtError).to.exist;
    expect(caughtError).to.be.instanceOf(Error);
    if (msg) {
        expect(caughtError.message).to.equal(msg);
    }
}

export class RequestError extends Error {

    error: {
        error: TypeError;
    };

    constructor(msg: string, type: string) {
        super(msg);
        this.error = {
            error: new TypeError(msg, type)
        };
    }
}

export class TypeError extends Error {
    type: string;

    constructor(msg: string, type: string) {
        super(msg);
        this.type = type;
    }
}