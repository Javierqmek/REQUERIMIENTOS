// El SDK de navegador requiere acceso a estas cookies; HttpOnly rompería el flujo.
export const authCookieOptions = {
  path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production",
};
