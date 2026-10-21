/** One build serves all four surfaces (PDF §6). The surface is chosen from the hostname at runtime. */
export const environment = {
  production: false,
  platformDomain: 'localhost', // dev: localhost:4200 / admin.localhost:4200 / kavya.localhost:4200
};
