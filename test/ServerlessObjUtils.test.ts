import * as Chai from "chai";
import * as Utils from "../src/ServerlessObjUtils";

const expect = Chai.expect;

describe("ServerlessObjUtils", () => {
    describe("GetRegion", () => {
        it("Tests that the region is retrieved from the serverless obj.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {
                        stage: "dev",
                        region: "TestRegion"
                    }
                }
            };
            expect(Utils.getRegion(serverless as any)).to.equal("TestRegion");
        });

        it("Tests that the region is defaulted from serverless obj if region is not provided but a default region is.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {}
                }
            };
            expect(Utils.getRegion(serverless as any, "us-east-1")).to.equal("us-east-1");
        });

        it("Tests that the region is defaulted from serverless obj if provider is not provided but a default region is.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                }
            } as any;
            expect(Utils.getRegion(serverless as any, "us-east-1")).to.equal("us-east-1");
        });
    });

    describe("GetProfile", () => {
        it("Tests that the profile is retrieved from the serverless obj.", () => {
            const serverless = {
                providers: {
                    aws: {
                        options: {
                            awsProfile: "TestProfile"
                        }
                    }
                },
                service: {
                    getServiceName: () => "TestService",
                }
            };
            expect(Utils.getProfile(serverless as any)).to.equal("TestProfile");
        });

        it("Tests that the profile is defaulted from serverless obj if profile is not provided.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {}
                }
            };
            expect(Utils.getProfile(serverless as any)).to.equal("default");
        });

        it("Tests that the profile is defaulted to the one specified if profile is not provided from serverless object.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {}
                }
            };
            expect(Utils.getProfile(serverless as any, "MyDefaultProfile")).to.equal("MyDefaultProfile");
        });

        it("Tests that the profile is defaulted from serverless obj if provider is not provided.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                }
            };
            expect(Utils.getProfile(serverless as any)).to.equal("default");
        });
    });

    describe("GetStage", () => {
        it("Tests that the stage is returned.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {
                        stage: "prod"
                    }
                }
            };
            expect(Utils.getStage(serverless as any)).to.equal("prod");
        });

        it("Tests that the stage is defaulted to \"dev\".", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {}
                }
            };
            expect(Utils.getStage(serverless as any)).to.equal("dev");
        });


        it("Tests that the default stage provided is returned when stage is not provided.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {}
                }
            };
            expect(Utils.getStage(serverless as any, "fake")).to.equal("fake");
        });
    });

    describe("GetStackName", () => {
        it("Tests that the stack name of the object is returned.", () => {
            const serverless = {
                service: {
                    getServiceName: () => "TestService",
                    provider: {
                        stage: "prod"
                    }
                }
            };
            expect(Utils.getStackName(serverless as any)).to.equal("TestService-prod");
        });
    });
});