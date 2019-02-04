export class ResourceNotFound extends Error {
    constructor(msg: string) {
        super(msg);
    }
}

export default ResourceNotFound;