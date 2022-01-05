import * as Chai from "chai";
import * as path from "path";
import * as Request from "request-promise-native";
import * as Serverless from "serverless";
import * as ServerlessPlugin from "serverless/classes/Plugin";
import * as Sinon from "sinon";
import * as SinonChai from "sinon-chai";
import * as AwsUtils from "../src/AwsUtils";
import Config, { Index, IngestionPipeline, Repository, Template } from "../src/Config";
import Plugin, { incrementVersionValue, replaceServerlessTemplates, stripVersion } from "../src/Plugin";

Chai.use(SinonChai);
const expect = Chai.expect;

const fakeServerless: any = {
    service: {
        getServiceName: () => "TestService",
        provider: {
            name: "aws",
            region: "us-east-1"
        }
    },
    cli: {
        log: (message: string) => console.log(message)
    }
};

const endpointConfig: Config = {
    endpoint: "ABCD123"
};

describe("Plugin", () => {
    const sanbox = Sinon.createSandbox();
    let findCloudformationExportStub: Sinon.SinonStub<any, any>;
    let assumeRoleStub: Sinon.SinonStub<any, any>;
    let putStub: Sinon.SinonStub<any, any>;
    let postStub: Sinon.SinonStub<any, any>;
    let getStub: Sinon.SinonStub<any, any>;

    before(() => {
        putStub = sanbox.stub(Request, "put");
        postStub = sanbox.stub(Request, "post");
        getStub = sanbox.stub(Request, "get");

        findCloudformationExportStub = sanbox.stub(AwsUtils, "findCloudformationExport");
        assumeRoleStub = sanbox.stub(AwsUtils, "assumeRole");
    });

    beforeEach(() => {
        sanbox.resetHistory();
        sanbox.resetBehavior();

        putStub.returns(Promise.resolve());

        postStub.returns(Promise.resolve());

        getStub.returns(Promise.resolve());

        findCloudformationExportStub.returns(Promise.resolve(endpointConfig.endpoint));

        assumeRoleStub.returns(Promise.resolve({
            accessKeyId: "TestKeyId",
            secretAccessKey: "TestSecret"
        }));
    });

    after(() => {
        sanbox.restore();
    });

    describe(stripVersion.name, async () => {
        it("Strips the version off the name", () => {
            expect(stripVersion("MyName_v1")).to.equal("MyName");
        });

        it("Ignores no version", () => {
            expect(stripVersion("MyName")).to.equal("MyName");
        });

        it("Keeps a sub version", () => {
            expect(stripVersion("MyName_v1_v1")).to.equal("MyName_v1");
        });
    });

    describe(replaceServerlessTemplates.name, async () => {
        describe("template.indices", () => {
            it("Tests that empty indices is handled.", async () => {
                const serverless = {
                    ...fakeServerless,
                    functions: {
                        myFunc: {
                            name: "MyFuncName",
                            environment: {
                                INDEX: "{{esSetup.template.indices: index1}}",
                            }
                        }
                    }
                };
                const variables = {
                    template: {
                        indices: {
                        }
                    }
                };
                const returnServerless = replaceServerlessTemplates(variables, serverless);
                expect(returnServerless).to.deep.equal({
                    ...fakeServerless,
                    functions: {
                        myFunc: {
                            name: "MyFuncName",
                            environment: {
                                INDEX: "{{esSetup.template.indices: index1}}",
                            }
                        }
                    }
                });
                expect(serverless, "The original object was not modified.  It should be modified.").to.deep.equal(returnServerless);
            });

            it("Tests that the template is replaced.", async () => {
                const serverless = {
                    ...fakeServerless,
                    functions: {
                        myFunc: {
                            name: "MyFuncName",
                            environment: {
                                INDEX: "{{esSetup.template.indices: index1}}",
                                VALUE: "{{self:custom.value}}",
                                VALUE2: "MyValue",
                                boolValue: true,
                                numValue: 3
                            }
                        }
                    },
                    resources: {
                        Resource: {
                            myResource: {
                                // tslint:disable-next-line
                                nullAttrib: null,
                                undefinedAttrib: undefined,
                                arrAttrib: [
                                    "test {{esSetup.template.indices:index2}} string ",
                                    "{{esSetup.template.indices:    index3}}"
                                ],
                                arrObjAttrib: [{
                                    param1: "my template {{esSetup.template.indices: index4}}"
                                }]
                            }
                        },
                        Outputs: {
                            myOutput: {
                                Value: "{{esSetup.template.indices: index5}}",
                                Export: "es_index_{{esSetup.template.indices: index6}}"
                            }
                        }
                    }
                };
                const variables = {
                    template: {
                        indices: {
                            index1: "index1_v1",
                            index2: "index2_v1",
                            index3: "index3_v1",
                            index4: "index4_v1",
                            index5: "index5_v1",
                            index6: "index6_v1",
                            index7: "index7_v1",
                        }
                    }
                };
                const returnServerless = replaceServerlessTemplates(variables, serverless);
                expect(returnServerless).to.deep.equal({
                    ...fakeServerless,
                    functions: {
                        myFunc: {
                            name: "MyFuncName",
                            environment: {
                                INDEX: "index1_v1",
                                VALUE: "{{self:custom.value}}",
                                VALUE2: "MyValue",
                                boolValue: true,
                                numValue: 3
                            }
                        }
                    },
                    resources: {
                        Resource: {
                            myResource: {
                                // tslint:disable-next-line
                                nullAttrib: null,
                                undefinedAttrib: undefined,
                                arrAttrib: [
                                    "test index2_v1 string ",
                                    "index3_v1"
                                ],
                                arrObjAttrib: [{
                                    param1: "my template index4_v1"
                                }]
                            }
                        },
                        Outputs: {
                            myOutput: {
                                Value: "index5_v1",
                                Export: "es_index_index6_v1"
                            }
                        }
                    }
                });
                expect(serverless, "The original object was not modified.  It should be modified.").to.deep.equal(returnServerless);
            });
        });
    });

    describe(incrementVersionValue.name, async () => {
        it("Tests that the version is incremented when no version is present.", () => {
            const value = incrementVersionValue("TestValue");
            expect(value).to.equal("TestValue_v1");
        });

        it("Tests that the version is incremented when a version is present.", () => {
            const value = incrementVersionValue("TestValue_v1");
            expect(value).to.equal("TestValue_v2");
        });

        it("Tests that the version is incremented when a version is present with multiple digits.", () => {
            const value = incrementVersionValue("TestValue_v100");
            expect(value).to.equal("TestValue_v101");
        });

        it("Tests that weird named indices still works", () => {
            const value = incrementVersionValue("TestValue_v100_v100");
            expect(value).to.equal("TestValue_v100_v101");
        });
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

        it("Tests that nothing happens if the region being deployed to is different than the one said.", async () => {
            const serverless = createServerless([
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ]);
            serverless.service.provider.region = "us-east-1";
            serverless.service.custom.elasticsearch.endpoint = "TestCfEndpoint";
            serverless.service.custom.elasticsearch.onlyOnRegion = "SomeOtherRegion";

            const plugin: Plugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.not.have.been.called;
        });

        it("Tests that stuff happens if the regions matches the onlyOnRegion.", async () => {
            const serverless = createServerless([
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ]);
            serverless.service.provider.region = "us-east-1";
            serverless.service.custom.elasticsearch.endpoint = "TestCfEndpoint";
            serverless.service.custom.elasticsearch.onlyOnRegion = "us-east-1";

            const plugin: Plugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.called;
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

        it("Tests that setup is called if the elasticsearch is an array.", async () => {
            const serverless = createServerless([
                {
                    name: "Index1",
                    file: "./test/testFiles/TestIndices1.json"
                }
            ]);
            serverless.service.custom.elasticsearch = [{
                ...serverless.service.custom.elasticsearch,
                endpoint: "TestCfEndpoint1"
            }, {
                ...serverless.service.custom.elasticsearch,
                endpoint: "TestCfEndpoint2"
            }];
            serverless.service.custom.elasticsearch.endpoint = "TestCfEndpoint";

            const plugin: Plugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(putStub).to.have.been.calledWith("https://TestCfEndpoint1/Index1");
            expect(putStub).to.have.been.calledWith("https://TestCfEndpoint2/Index1");
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

            checkAndDeleteHeadersForEveryCall(putStub);
            expect(putStub).to.have.been.calledWith("https://ABCD123/Index1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: index1,
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
            checkAndDeleteHeadersForEveryCall(putStub);
            expect(putStub).to.have.been.calledWith("https://ABCD123/Index1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: index1,
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

            checkAndDeleteHeadersForEveryCall(putStub);
            expect(putStub).to.have.been.calledWith("https://ABCD123/Index1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: index1,
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/Index2", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: index2,
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

            checkAndDeleteHeadersForEveryCall(putStub);

            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: template1,
            });
        });

        it("Tests that the parameters are replaced with values.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate3",
                file: "./test/testFiles/TestTemplate3.json",
                parameters: {
                    PARAM1: "Value1",
                    PARAM2: "Value2"
                }
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            const template3 = require(path.resolve(templates[0].file));
            template3.index_patterns = ["Value1_test_Value2", "test_Value1Value2_test", "test_${PARAM3}_test"];

            checkAndDeleteHeadersForEveryCall(putStub);
            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate3", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: template3,
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

            checkAndDeleteHeadersForEveryCall(putStub);

            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: template1,
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/_template/TestTemplate2", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: template2,
            });
        });

        it("Tests that an index is not swapped if the previous template is not found.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json",
                shouldSwapIndicesOfAliases: true
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const notFoundError: Error & { statusCode?: number } = new Error("Not found.");
            notFoundError.statusCode = 404;
            getStub.onFirstCall().returns(Promise.reject(notFoundError));
            getStub.onSecondCall().returns(Promise.resolve(JSON.stringify({
                index1: {},
                index2_v1: {}
            })));
            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_reindex");
            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_aliases");
        });

        it("Tests that an error is thrown if status code is returned that's not a 404 when retrieving previous templates", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json",
                shouldSwapIndicesOfAliases: true
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const networkError: Error & { statusCode?: number } = new Error("Error per requirement of the test.");
            networkError.statusCode = 500;
            getStub.onFirstCall().returns(Promise.reject(networkError));
            getStub.onSecondCall().returns(Promise.resolve(JSON.stringify({
                index1: {},
                index2_v1: {}
            })));
            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();

            let caughtError: Error;
            try {
                await plugin.hooks["after:aws:deploy:deploy:updateStack"]();
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).to.equal(networkError);
            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_reindex");
            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_aliases");
        });

        it("Tests that an index is not swapped if the previous alias is not found.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json",
                shouldSwapIndicesOfAliases: true
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const notFoundError: Error & { statusCode?: number } = new Error("Not found.");
            notFoundError.statusCode = 404;
            getStub.onFirstCall().returns(Promise.resolve(JSON.stringify({
                TestTemplate1: {
                    aliases: {
                        alias1: {
                        }
                    }
                }
            })));
            getStub.onSecondCall().returns(Promise.reject(notFoundError));
            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_reindex");
            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_aliases");
        });

        it("Tests that an error is thrown if status code is returned that's not a 404 when retrieving previous aliases", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json",
                shouldSwapIndicesOfAliases: true
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            const networkError: Error & { statusCode?: number } = new Error("Error per requirement of the test.");
            networkError.statusCode = 500;
            getStub.onFirstCall().returns(Promise.resolve(JSON.stringify({
                TestTemplate1: {
                    aliases: {
                        alias1: {
                        }
                    }
                }
            })));
            getStub.onSecondCall().returns(Promise.reject(networkError));
            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();

            let caughtError: Error;
            try {
                await plugin.hooks["after:aws:deploy:deploy:updateStack"]();
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).to.equal(networkError);
            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_reindex");
            expect(postStub).to.not.have.been.calledWithMatch("https://ABCD123/_aliases");
        });

        it("Tests that an index is swapped if requested.", async () => {
            const templates: Template[] = [{
                name: "TestTemplate1",
                file: "./test/testFiles/TestTemplate1.json",
                shouldSwapIndicesOfAliases: true
            }];

            const serverless = createServerless(templates);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            getStub.onFirstCall().returns(Promise.resolve(JSON.stringify({
                TestTemplate1: {
                    aliases: {
                        alias1: {
                        }
                    }
                }
            })));
            getStub.onSecondCall().returns(Promise.resolve(JSON.stringify({
                index1: {},
                index2_v1: {}
            })));
            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            checkAndDeleteHeadersForEveryCall(getStub);
            checkAndDeleteHeadersForEveryCall(postStub);
            checkAndDeleteHeadersForEveryCall(putStub);

            expect(getStub.firstCall).to.have.been.calledWithMatch("https://ABCD123/_template/TestTemplate1", {
                json: undefined,
            });
            expect(getStub.secondCall).to.have.been.calledWithMatch("https://ABCD123/_alias/alias1", {
                json: undefined,
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/index1_v1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {}
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/index2_v2", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {}
            });
            expect(postStub).to.have.been.calledWith("https://ABCD123/_reindex?wait_for_completion=false", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    source: {
                        index: "index1"
                    },
                    dest: {
                        index: "index1_v1",
                        pipeline: undefined
                    }
                },
            });
            expect(postStub).to.have.been.calledWith("https://ABCD123/_reindex?wait_for_completion=false", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    source: {
                        index: "index2_v1"
                    },
                    dest: {
                        index: "index2_v2",
                        pipeline: undefined
                    }
                },
            });
            expect(postStub).to.have.been.calledWith("https://ABCD123/_aliases", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    actions: [{
                        add: {
                            index: "index1_v1",
                            alias: "alias1"
                        }
                    }, {
                        remove_index: {
                            index: "index1"
                        }
                    }]
                },
            });
            expect(postStub).to.have.been.calledWith("https://ABCD123/_aliases", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    actions: [{
                        add: {
                            index: "index2_v2",
                            alias: "alias1"
                        }
                    }, {
                        remove_index: {
                            index: "index2_v1"
                        }
                    }]
                },
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

            checkAndDeleteHeadersForEveryCall(putStub);
            expect(putStub).to.have.been.calledWith("https://ABCD123/_snapshot/TestRepo", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    type: repos[0].type,
                    settings: repos[0].settings
                },
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

            checkAndDeleteHeadersForEveryCall(putStub);

            expect(putStub).to.have.been.calledWith("https://ABCD123/_snapshot/TestRepo1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    type: repos[0].type,
                    settings: repos[0].settings
                }
            });

            expect(putStub).to.have.been.calledWith("https://ABCD123/_snapshot/TestRepo2", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: {
                    type: repos[1].type,
                    settings: repos[1].settings
                }
            });
        });
    });

    describe("Setup ingestion pipelines", () => {
        function createServerless(pipelines: IngestionPipeline[]): Serverless {
            return {
                ...fakeServerless,
                service: {
                    ...fakeServerless.service,
                    custom: {
                        elasticsearch: {
                            ...endpointConfig,
                            pipelines
                        }
                    }
                }
            };
        }

        it("Tests that an error is thrown if the pipeline doesn't have a name.", async () => {
            const pipelines: IngestionPipeline[] = [{
                name: undefined,
                file: "./test/testFiles/TestPipeline1.json"
            }];

            const serverless = createServerless(pipelines);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that an error is thrown if the pipeline doesn't have a file.", async () => {
            const pipelines: IngestionPipeline[] = [{
                name: "TestPipeline",
                file: undefined
            }];

            const serverless = createServerless(pipelines);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that the pipeline is set up.", async () => {
            const pipelines: IngestionPipeline[] = [{
                name: "TestPipeline1",
                file: "./test/testFiles/TestPipeline1.json"
            }, {
                name: "TestPipeline2",
                file: "./test/testFiles/TestPipeline1.json"
            }];

            const serverless = createServerless(pipelines);
            const plugin: ServerlessPlugin = new Plugin(serverless);

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await plugin.hooks["after:aws:deploy:deploy:updateStack"]();

            const pipeline1 = require(path.resolve(pipelines[0].file));
            const pipeline2 = require(path.resolve(pipelines[1].file));

            checkAndDeleteHeadersForEveryCall(putStub);
            expect(putStub).to.have.been.calledWith("https://ABCD123/_ingest/pipeline/TestPipeline1", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: pipeline1,
            });
            expect(putStub).to.have.been.calledWith("https://ABCD123/_ingest/pipeline/TestPipeline2", {
                aws: { key: "TestKeyId", secret: "TestSecret", service: "es", sign_version: 4 },
                json: pipeline2,
            });
        });
    });
});

/**
 * Every call to Elasticsearch is the same headers, but it's near
 * impossible to mock the entire header. So this checks the headers as
 * best as possible and removes it from the object so easier
 * comparisons can be made.
 *
 * @param {Sinon.SiononStub} stub
 */
function checkAndDeleteHeadersForEveryCall(stub: Sinon.SinonStub) {
    for (const call of stub.args) {
        const headers = call[1].headers;
        expect(headers).to.have.property("Content-Type", "application/json");
        delete call[1].headers;
    }
}

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