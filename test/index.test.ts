import * as Chai from "chai";
import * as path from "path";
import * as Request from "request-promise-native";
import * as Sinon from "sinon";
import * as SinonChai from "sinon-chai";
import Config, { Index } from "../src/Config";
import Serverless from "../src/Serverless";
import ServerlessPlugin from "../src/ServerlessPlugin";

const Plugin = require("../src/index");

Chai.use(SinonChai);
const expect = Chai.expect;

interface Custom {
    elasticsearch?: Config;
}

const fakeServerless: Serverless<Custom> = {
    service: {},
    cli: {
        log: Sinon.stub()
    }
};

const endpointConfig: Config = {
    "endpoint": "ABCD123",
};

describe("index", () => {

    let putStub: Sinon.SinonStub;

    before(() => {
        putStub = Sinon.stub(Request, "put");
    });

    beforeEach(() => {
        putStub.resetHistory();
        putStub.resetBehavior();
        putStub.returns(Promise.resolve());
    });

    describe("Create", () => {
        it("Tests that an error is thrown if there is no domain.", async () => {
            const serverless = {...fakeServerless };
            const plugin: ServerlessPlugin = new Plugin(serverless, {});

            await checkAndCatchError(() => plugin.hooks["before:aws:deploy:deploy:updateStack"]());
        });
    });

    describe("Setup indices", () => {

        function createServerless(indices: Index[]): Serverless<Custom> {
            return {
                ...fakeServerless,
                service: {
                    custom: {
                        elasticsearch: {
                            ...endpointConfig,
                            indices
                        }
                    }
                }
            };
        }

        it("Tests that an error is thrown if a name is not provided for index.", async () => {
            const indices: Index[] = [{
                name: undefined,
                file: "./test/testFiles/TestIndices1.json"
            }];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless, {});

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });

        it("Tests that an error is thrown if a file location is not provided for index.", async () => {
            const indices: Index[] = [{
                name: "Index1",
                file: undefined
            }];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless, {});

            await plugin.hooks["before:aws:deploy:deploy:updateStack"]();
            await checkAndCatchError(() => plugin.hooks["after:aws:deploy:deploy:updateStack"]());
        });


        it("Tests that a single index is sent to the server url.", async () => {
            const indices: Index[] = [{
                name: "Index1",
                file: "./test/testFiles/TestIndices1.json"
            }];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless, {});

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

        it("Tests that multiple indices is sent to the server url.", async () => {
            const indices: Index[] = [{
                name: "Index1",
                file: "./test/testFiles/TestIndices1.json"
            }, {
                name: "Index2",
                file: "./test/testFiles/TestIndices2.json"
            }];
            const serverless = createServerless(indices);
            const plugin: ServerlessPlugin = new Plugin(serverless, {});

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
});

async function checkAndCatchError(callback: () => any): Promise<void> {
    let caughtError: Error;
    try {
        await Promise.resolve().then(callback);
    } catch (e) {
        caughtError = e;
    }
    expect(caughtError).to.exist;
    expect(caughtError).to.be.instanceOf(Error);
}