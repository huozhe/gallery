import { requireSession } from "@/lib/auth";
import { users } from "@/lib/store";
import { UsersManager } from "./_components/UsersManager";

export default async function AdminUsersPage() {
  const { user } = await requireSession();
  const allUsers = await users.list();
  return (
    <main className="px-8 py-10 max-w-2xl">
      <h1 className="text-xl font-medium mb-8">Users</h1>
      <UsersManager users={allUsers} currentUserEmail={user.email} />
    </main>
  );
}
