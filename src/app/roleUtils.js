export const FALLBACK_ROLE = "driver";
export const ALLOWED_ROLES = ["admin", "owner", "operator", "driver"];

export const ROLE_HOME = {
  admin: "/admin/home",
  owner: "/owner/home",
  operator: "/operator/home",
  driver: "/driver/home",
};

export function sanitizeRole(inputRole) {
  return ALLOWED_ROLES.includes(inputRole) ? inputRole : FALLBACK_ROLE;
}

export function getRoleHome(role) {
  return ROLE_HOME[sanitizeRole(role)];
}
