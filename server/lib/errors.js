// Fastify turns an error with a statusCode into a JSON error response.
export const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
