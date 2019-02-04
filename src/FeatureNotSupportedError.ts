export class FeatureNotSupported extends Error {
    constructor(msg: string) {
        super(msg);
    }
}

export default FeatureNotSupported;