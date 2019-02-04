import { Serverless, ServerlessProvider } from "@xapp/serverless-plugin-type-definitions";
import * as Chai from "chai";
import * as Utils from "../src/ServerlessObjUtils";

type AnyServerless = Serverless<any>;
type PartialServerless = Partial<AnyServerless>;

const expect = Chai.expect;

describe("ServerlessObjUtils", () => {
    describe("GetRegion", () => {
        it("Tests that the region is retrieved from the serverless obj.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {
                        region: "TestRegion"
                    } as ServerlessProvider
                }
            };
            expect(Utils.getRegion(serverless as AnyServerless)).to.equal("TestRegion");
        });

        it("Tests that the region is defaulted from serverless obj if region is not provided but a default region is.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {} as ServerlessProvider
                }
            };
            expect(Utils.getRegion(serverless as AnyServerless, "us-east-1")).to.equal("us-east-1");
        });

        it("Tests that the region is defaulted from serverless obj if provider is not provided but a default region is.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService"
                }
            };
            expect(Utils.getRegion(serverless as AnyServerless, "us-east-1")).to.equal("us-east-1");
        });
    });

    describe("GetProfile", () => {
        it("Tests that the profile is retrieved from the serverless obj.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {
                        profile: "TestProfile"
                    } as ServerlessProvider
                }
            };
            expect(Utils.getProfile(serverless as AnyServerless)).to.equal("TestProfile");
        });

        it("Tests that the profile is defaulted from serverless obj if profile is not provided.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {} as ServerlessProvider
                }
            };
            expect(Utils.getProfile(serverless as AnyServerless)).to.equal("default");
        });

        it("Tests that the profile is defaulted to the one specified if profile is not provided from serverless object.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {} as ServerlessProvider
                }
            };
            expect(Utils.getProfile(serverless as AnyServerless, "MyDefaultProfile")).to.equal("MyDefaultProfile");
        });

        it("Tests that the profile is defaulted from serverless obj if provider is not provided.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService"
                }
            };
            expect(Utils.getProfile(serverless as AnyServerless)).to.equal("default");
        });
    });

    describe("GetStage", () => {
        it("Tests that the stage is returned.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {
                        stage: "prod"
                    } as ServerlessProvider
                }
            };
            expect(Utils.getStage(serverless as AnyServerless)).to.equal("prod");
        });

        it("Tests that the stage is defaulted to \"dev\".", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {} as ServerlessProvider
                }
            };
            expect(Utils.getStage(serverless as AnyServerless)).to.equal("dev");
        });


        it("Tests that the default stage provided is returned when stage is not provided.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {} as ServerlessProvider
                }
            };
            expect(Utils.getStage(serverless as AnyServerless, "fake")).to.equal("fake");
        });
    });

    describe("GetStackName", () => {
        it("Tests that the stack name of the object is returned.", () => {
            const serverless: PartialServerless = {
                service: {
                    service: "TestService",
                    provider: {
                        stage: "prod"
                    } as ServerlessProvider
                }
            };
            expect(Utils.getStackName(serverless as AnyServerless)).to.equal("TestService-prod");
        });
    });
});