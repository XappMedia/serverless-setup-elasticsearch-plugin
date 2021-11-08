import { STS } from "aws-sdk";
import * as Chai from "chai";
import * as Request from "request-promise-native";
import * as Sinon from "sinon";
import * as SinonChai from "sinon-chai";
import { Repository } from "../src/Config";
import * as SetupRepo from "../src/SetupRepo";

Chai.use(SinonChai);
const expect = Chai.expect;

const sts = new STS();

describe("SetupRepo", () => {

    let getCallerIdentityStub: Sinon.SinonStub;
    let putRequestStub: Sinon.SinonStub;

    before(() => {
        getCallerIdentityStub = Sinon.stub(sts, "getCallerIdentity");

        putRequestStub = Sinon.stub(Request, "put");
    });

    beforeEach(() => {
        getCallerIdentityStub.resetHistory();
        getCallerIdentityStub.resetBehavior();
        getCallerIdentityStub.returns({
            promise: () => Promise.resolve({ Account: 123456 })
        });

        putRequestStub.resetHistory();
        putRequestStub.resetBehavior();
        putRequestStub.returns(Promise.resolve());
    });

    after(() => {
        putRequestStub.restore();
    });

    describe("setupRepo", () => {
        it("Tests that a repo without a name throws an error.", async () => {
            const repos: Repository[] = [{
                type: "s3",
                name: undefined,
                settings: {
                    bucket: "TestBucket1",
                    role_arn: "arn:aws:iam::123456:role/TestRole1"
                }
            }];

            let caughtError: Error;
            try {
                await SetupRepo.setupRepo({
                    baseUrl: "https:testUrl.com",
                    repos,
                    sts,
                    credentials: {},
                    requestOptions: {
                        aws: {
                            secret: "ABCD123"
                        }
                    }
                });
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).to.exist;
            expect(caughtError.message).to.equal("Repo does not have a name.");
        });

        it("Tests that a repo without a type throws an error.", async () => {
            const repos: Repository[] = [{
                type: undefined,
                name: "TestRepo",
                settings: {
                    bucket: "TestBucket1",
                    role_arn: "arn:aws:iam::123456:role/TestRole1"
                }
            }];

            let caughtError: Error;
            try {
                await SetupRepo.setupRepo({
                    baseUrl: "https:testUrl.com",
                    repos,
                    sts,
                    credentials: {},
                    requestOptions: {
                        aws: {
                            secret: "ABCD123"
                        }
                    }
                });
            } catch (e) {
                caughtError = e;
            }
            expect(caughtError).to.exist;
            expect(caughtError.message).to.equal("Repo does not have a type.");
        });

        it("Tests that the repo items are sent to the server.", async () => {
            const repos: Repository[] = [{
                type: "s3",
                name: "testRepo1",
                settings: {
                    bucket: "TestBucket1",
                    role_arn: "arn:aws:iam::123456:role/TestRole1"
                }
            }, {
                type: "s3",
                name: "testRepo2",
                settings: {
                    bucket: "TestBucket2",
                    role_arn: "arn:aws:iam::123456:role/TestRole2"
                }
            }];

            await SetupRepo.setupRepo({
                baseUrl: "https:testUrl.com",
                repos,
                sts,
                credentials: {
                    secretAccessKey: "ABCD123"
                },
                requestOptions: {
                }
            });

            expect(putRequestStub).to.have.been.calledWithMatch("https:testUrl.com/_snapshot/testRepo1", {
                headers: { "Content-Type": "application/json" },
                json: {
                    type: "s3",
                    settings: {
                        bucket: "TestBucket1",
                        role_arn: "arn:aws:iam::123456:role/TestRole1"
                    }
                },
                aws: {
                    secret: "ABCD123"
                }
            });

            expect(putRequestStub).to.have.been.calledWithMatch("https:testUrl.com/_snapshot/testRepo2", {
                headers: { "Content-Type": "application/json" },
                json: {
                    type: "s3",
                    settings: {
                        bucket: "TestBucket2",
                        role_arn: "arn:aws:iam::123456:role/TestRole2"
                    }
                },
                aws: {
                    secret: "ABCD123"
                }
            });
        });

        it("Tests that an undefined repo key is handled.", async () => {
            await SetupRepo.setupRepo({
                baseUrl: "https:testUrl.com",
                repos: undefined,
                sts,
                credentials: {},
                requestOptions: {
                    aws: {
                        secret: "ABCD123"
                    }
                }
            });

            expect(putRequestStub).to.not.have.been.called;
        });
    });

    describe("discoverRepoArn", () => {
        it("Tests that the ARN for the role is delivered.", async () => {
            const config = await SetupRepo.discoverRepoArn(sts, {
                name: "TestRepo",
                type: "s3",
                settings: {
                    role_name: "TestRole",
                    bucket: "WhoCares",
                    region: "us-east-1"
                }
            });
            expect(config).to.deep.equal({
                name: "TestRepo",
                type: "s3",
                settings: {
                    role_arn: "arn:aws:iam::123456:role/TestRole",
                    bucket: "WhoCares",
                    region: "us-east-1"
                }
            });
        });

        it("Tests that the settings object with role_arn is just sent as-is.", async () => {
            const config = await SetupRepo.discoverRepoArn(sts, {
                name: "TestRepo",
                type: "s3",
                settings: {
                    role_arn: "arn:aws:iam::123456:role/TestRole",
                    bucket: "WhoCares",
                    region: "us-east-1"
                }
            });
            expect(config).to.deep.equal({
                name: "TestRepo",
                type: "s3",
                settings: {
                    role_arn: "arn:aws:iam::123456:role/TestRole",
                    bucket: "WhoCares",
                    region: "us-east-1"
                }
            });
        });
    });
});