export interface ServerlessProvider {
    region?: string;
    profile?: string;
}

export interface CLI {
    log(msg: string): void;
}

export interface ServerlessService<Custom> {
    provider?: ServerlessProvider;
    custom?: Custom;
}

export interface Serverless<Custom> {
    service: ServerlessService<Custom>;
    cli: CLI;
}

export default Serverless;