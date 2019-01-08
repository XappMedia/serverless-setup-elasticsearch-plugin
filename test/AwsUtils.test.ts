import { CloudFormation } from "aws-sdk";
import * as Chai from "chai";
import * as Sinon from "sinon";
import * as SinonChai from "sinon-chai";
import * as AwsUtils from "../src/AwsUtils";

Chai.use(SinonChai);
const expect = Chai.expect;

describe("AwsUtils", () => {
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
        const cf = new CloudFormation();
        let listExportsStub: Sinon.SinonStub;

        before(() => {
            listExportsStub = Sinon.stub(cf, "listExports");
        });

        beforeEach(() => {
            listExportsStub.resetHistory();
            listExportsStub.resetBehavior();
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
