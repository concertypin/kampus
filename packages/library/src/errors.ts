/**
 * Error thrown when e-campus authentication fails due to invalid credentials
 * or rejected session establishment.
 */
export class AuthError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "AuthError";
        Object.setPrototypeOf(this, AuthError.prototype);
    }
}
