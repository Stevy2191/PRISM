// Departments the current user may assign a contact to. Mirrors the server
// rule on PATCH /contacts/:id/department (which also moves the contact's
// tickets): holders of people.view_all may pick any department, everyone
// else only their own. `keepId` keeps a contact's current department listed
// so a select bound to it never renders blank.
export function assignableContactDepartments(departments, user, hasPermission, keepId = null) {
  if (hasPermission('people.view_all')) return departments;
  return departments.filter((d) => d.id === user?.departmentId || (keepId != null && d.id === Number(keepId)));
}
