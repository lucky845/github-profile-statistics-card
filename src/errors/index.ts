export class ErrorServiceUnavailable extends Error {
    constructor() {
        super('Service Temporarily Unavailable');
        this.name = 'ServiceUnavailable';
    }
}