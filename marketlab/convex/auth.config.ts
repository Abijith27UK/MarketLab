/**
 * Convex Auth provider configuration.
 * Tells the Convex platform which issuer/application may sign session JWTs.
 * `process.env.CONVEX_SITE_URL` is injected automatically for each deployment
 * (local anonymous deployments included).
 */
export default {
  providers: [
    {
      domain: process.env.CONVEX_SITE_URL,
      applicationID: "convex",
    },
  ],
};
