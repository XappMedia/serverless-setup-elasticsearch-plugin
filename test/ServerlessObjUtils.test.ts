import * as Chai from "chai";
import Serverless from "../src/Serverless";
import * as Utils from "../src/ServerlessObjUtils";

type AnyServerless = Serverless<any>;
type PartialServerless = Partial<AnyServerless>;

const expect = Chai.expect;

describe("ServerlessObjUtils", () => {
    describe("GetRegion", () => {
        it("Tests that the region is retrieved from the serverless obj.", () => {
            const serverless: PartialServerless = {
                service: {
                    provider: {
                        region: "TestRegion"
                    }
                }
            };
            expect(Utils.getRegion(serverless as AnyServerless)).to.equal("TestRegion");
        });

        it("Tests that the region is defaulted from serverless obj if region is not provided.", () => {
            const serverless: PartialServerless = {
                service: {
                    provider: {}
                }
            };
            expect(Utils.getRegion(serverless as AnyServerless)).to.equal("us-east-1");
        });

        it("Tests that the region is defaulted from serverless obj if provider is not provided.", () => {
            const serverless: PartialServerless = {
                service: { }
            };
            expect(Utils.getRegion(serverless as AnyServerless)).to.equal("us-east-1");
        });
    });

    describe("GetProfile", () => {
        it("Tests that the profile is retrieved from the serverless obj.", () => {
            const serverless: PartialServerless = {
                service: {
                    provider: {
                        profile: "TestProfile"
                    }
                }
            };
            expect(Utils.getProfile(serverless as AnyServerless)).to.equal("TestProfile");
        });

        it("Tests that the profile is defaulted from serverless obj if profile is not provided.", () => {
            const serverless: PartialServerless = {
                service: {
                    provider: {}
                }
            };
            expect(Utils.getProfile(serverless as AnyServerless)).to.equal("default");
        });

        it("Tests that the profile is defaulted from serverless obj if provider is not provided.", () => {
            const serverless: PartialServerless = {
                service: { }
            };
            expect(Utils.getProfile(serverless as AnyServerless)).to.equal("default");
        });
    });
});