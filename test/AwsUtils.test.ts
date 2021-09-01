import { CloudFormation } from "aws-sdk";
import * as Chai from "chai";
import * as Sinon from "sinon";
import * as SinonChai from "sinon-chai";
import * as AwsUtils from "../src/AwsUtils";
import FeatureNotSupportedError from "../src/FeatureNotSupportedError";
import ResourceNotFoundError from "../src/ResourceNotFoundError";

Chai.use(SinonChai);
const expect = Chai.expect;

const cf = new CloudFormation();

describe("AwsUtils", () => {

    let listExportsStub: Sinon.SinonStub<any, any>;
    let listStackResources: Sinon.SinonStub<any, any>;

    before(() => {
        listStackResources = Sinon.stub(cf, "listStackResources");
        listExportsStub = Sinon.stub(cf, "listExports");
    });

    beforeEach(() => {
        listStackResources.resetBehavior();
        listStackResources.resetHistory();
        listStackResources.returns({
            promise: () => Promise.resolve({ StackResourceSummaries: [] })
        });

        listExportsStub.resetHistory();
        listExportsStub.resetBehavior();
        listExportsStub.returns({
            promise: () => Promise.resolve({ Exports: [] })
        });
    });

    after(() => {
        listStackResources.restore();
    });

    describe("parseConfigObject", () => {

        it("Tests that an undefined and null object are returned properly", async () => {
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", undefined)).to.be.undefined;
            // tslint:disable:no-null-keyword
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", null)).to.be.null;
            // tslint:enable:no-null-keyword
        });

        it("Tests that an empty object is returned.", async () => {
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", {})).to.deep.equal({});
        });

        it("Tests that a primitive is returned.", async () => {
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", "Test")).to.equal("Test");
        });

        it("Tests that an object with an undefined and null parameter value is returned properly", async () => {
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", { param1: undefined })).to.deep.equal({ param1: undefined });
            // tslint:disable:no-null-keyword
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", { param1: null })).to.deep.equal({ param1: null });
            // tslint:enable:no-null-keyword
        });

        it("Tests that an object with a Ref parameter retrieves the physical ID.", async () => {
            listStackResources.returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "TestLogicalID",
                        PhysicalResourceId: "TestPhysicalID"
                    }]
                })
            });

            expect(await AwsUtils.parseConfigObject(cf, "TestStack", { param1: { Ref: "TestLogicalID"} })).to.deep.equal({ param1: "TestPhysicalID" });
        });

        it("Tests that an object that's not a CloudFormation item is returned properly.", async () => {
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", { param1: { param2: "Value1"} })).to.deep.equal({ param1: { param2: "Value1"} });
        });

        it("Tests that an array of items is parsed.", async () => {
            listStackResources.onFirstCall().returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "TestLogicalID1",
                        PhysicalResourceId: "TestPhysicalID1"
                    }],
                    NextToken: "NextToken1"
                })
            });
            listStackResources.onSecondCall().returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "TestLogicalID2",
                        PhysicalResourceId: "TestPhysicalID2"
                    }]
                })
            });
            const config = {
                param1: [{
                    Ref: "TestLogicalID1"
                }, {
                    Ref: "TestLogicalID2"
                },
                "value"]
            };
            expect(await AwsUtils.parseConfigObject(cf, "TestStack", config)).to.deep.equal({ param1: ["TestPhysicalID1", "TestPhysicalID2", "value"]});
        });
    });

    describe("RetrieveCloudFormationValue", () => {

        it("Tests that undefined or null returns their respective values.", async () => {
            expect(await AwsUtils.retrieveCloudFormationValue(cf, "TestStack", undefined)).to.be.undefined;
            // tslint:disable:no-null-keyword
            expect(await AwsUtils.retrieveCloudFormationValue(cf, "TestStack", null)).to.be.null;
            // tslint:enable:no-null-keyword
        });

        it("Tests that the Ref physical ID is returned.", async () => {
            listStackResources.returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "TestLogicalID",
                        PhysicalResourceId: "TestPhysicalID"
                    }]
                })
            });
            const id = await AwsUtils.retrieveCloudFormationValue(cf, "TestSTack", { Ref: "TestLogicalID" });
            expect(id).to.equal("TestPhysicalID");
        });

        it("Tests that it throws an error when a param entered is not a Cloudformation thing.", async () => {
            await testError(() => AwsUtils.retrieveCloudFormationValue(cf, "TestStack", { Param1: "Test" } as any), "CloudFormation value Param1 not currently supported.", FeatureNotSupportedError);
        });

        it("Tests that an error is thrown if there are too many parameters in the object.", async () => {
            await testError(() => AwsUtils.retrieveCloudFormationValue(cf, "TestStack", { Param1: "Test", Param2: "Test" } as any),
            "Value is not a CloudFormation parsable object.",
            Error);
        });
    });

    describe("findPhysicalId", () => {
        it("Tests that it loops until it is found.", async () => {
            listStackResources.onFirstCall().returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "Not the one we want",
                        PhysicalResourceId: "TestPhysicalID"
                    }],
                    NextToken: "NextToken1"
                })
            });
            listStackResources.onSecondCall().returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "Not the one we want",
                        PhysicalResourceId: "TestPhysicalID"
                    }],
                    NextToken: "NextToken2"
                })
            });
            listStackResources.onThirdCall().returns({
                promise: () => Promise.resolve({
                    StackResourceSummaries: [{
                        LogicalResourceId: "TestLogicalID",
                        PhysicalResourceId: "TestPhysicalID"
                    }]
                })
            });
            const id = await AwsUtils.findPhysicalID(cf, "TestSTackName", "TestLogicalID");
            expect(id).to.equal("TestPhysicalID");
        });

        it("Tests that it throws an error if the item is not found.", async () => {
            await testError(() => AwsUtils.findPhysicalID(cf, "TestStackName", "TestLogicalID"), "Physical ID not found for ref \"TestLogicalID\" in stack \"TestStackName\".", ResourceNotFoundError);
        });
    });

    describe("Cloudformation: Get Exported Value", () => {
        const cfExports: CloudFormation.ListExportsOutput = {
            Exports: [
                {
                    Name: "TestExport1",
                    Value: "TestExportValue1"
                },
                {
                    Name: "TestExport2",
                    Value: "TestExportValue2"
                },
                {
                    Name: "TestExport3",
                    Value: "TestExportValue3"
                }
            ]
        };

        beforeEach(() => {
            listExportsStub.returns({
                promise: () => Promise.resolve(cfExports)
            });
        });

        it("Tests that the export value is returned.", async () => {
            const exportValue = await AwsUtils.findCloudformationExport(cf, "TestExport3");
            expect(exportValue).to.equal("TestExportValue3");
        });

        it("Tests that undefined is returned if not found.", async () => {
            const exportValue = await AwsUtils.findCloudformationExport(cf, "Not found export");
            expect(exportValue).to.be.undefined;
        });

        it("Tests that it will use the NextToken", async () => {
            listExportsStub.onFirstCall().returns({
                promise: () =>
                    Promise.resolve({
                        Exports: [
                            {
                                Name: "TestExport4",
                                Value: "TestExportValue4"
                            },
                            {
                                Name: "TestExport5",
                                Value: "TestExportValue5"
                            },
                            {
                                Name: "TestExport6",
                                Value: "TestExportValue6"
                            }
                        ],
                        NextToken: "ABCD123"
                    })
            });

            const exportValue = await AwsUtils.findCloudformationExport(cf, "TestExport3");
            expect(listExportsStub).to.have.been.calledWithMatch({ NextToken: "ABCD123" });
            expect(exportValue).to.equal("TestExportValue3");
        });
    });
});

async function testError(callback: () => any, msg?: string, instanceOfType?: object) {
    let caughtError: Error;
    try {
        await callback();
    } catch (e) {
        caughtError = e;
    }
    expect(caughtError).to.exist;
    if (msg) {
        expect(caughtError.message).to.equal(msg);
    }
    if (instanceOfType) {
        expect(caughtError).to.be.instanceOf(instanceOfType);
    }
}