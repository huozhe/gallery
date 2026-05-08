"use client";

import { useTransition, useState } from "react";
import type { User } from "@/data/types";
import {
  changePassword,
  createAdminUser,
  deleteAdminUser,
} from "@/app/admin/actions";

type Props = {
  users: User[];
  currentUserEmail: string;
};

export function UsersManager({ users: initialUsers, currentUserEmail }: Props) {
  const [userList, setUserList] = useState(initialUsers);

  return (
    <div className="space-y-10">
      <ChangePasswordForm />
      <AddUserForm
        onCreated={(u) => setUserList((prev) => [...prev, u])}
      />
      <UserTable
        users={userList}
        currentUserEmail={currentUserEmail}
        onDeleted={(email) =>
          setUserList((prev) => prev.filter((u) => u.email !== email))
        }
      />
    </div>
  );
}

function ChangePasswordForm() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      currentPassword: (form.elements.namedItem("currentPassword") as HTMLInputElement).value,
      newPassword: (form.elements.namedItem("newPassword") as HTMLInputElement).value,
    };
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await changePassword(data);
      if (result.success) {
        setSaved(true);
        form.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-900 mb-4">Change password</h2>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label htmlFor="currentPassword" className="block text-sm text-neutral-700 mb-1">
            Current password
          </label>
          <input
            id="currentPassword"
            name="currentPassword"
            type="password"
            required
            autoComplete="current-password"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
        </div>
        <div>
          <label htmlFor="newPassword" className="block text-sm text-neutral-700 mb-1">
            New password
          </label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Change password"}
          </button>
          {saved && <span className="text-sm text-neutral-500">Saved.</span>}
        </div>
      </form>
    </section>
  );
}

function AddUserForm({ onCreated }: { onCreated: (u: User) => void }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = {
      email: (form.elements.namedItem("email") as HTMLInputElement).value,
      password: (form.elements.namedItem("password") as HTMLInputElement).value,
    };
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await createAdminUser(data);
      if (result.success) {
        setSaved(true);
        onCreated({
          id: "",
          email: data.email.toLowerCase(),
          passwordHash: "",
          createdAt: new Date().toISOString(),
        });
        form.reset();
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-900 mb-4">Add user</h2>
      <form onSubmit={handleSubmit} className="space-y-3 max-w-sm">
        <div>
          <label htmlFor="addEmail" className="block text-sm text-neutral-700 mb-1">
            Email
          </label>
          <input
            id="addEmail"
            name="email"
            type="email"
            required
            autoComplete="off"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
        </div>
        <div>
          <label htmlFor="addPassword" className="block text-sm text-neutral-700 mb-1">
            Password
          </label>
          <input
            id="addPassword"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
            className="w-full border border-neutral-300 px-3 py-2 text-sm text-neutral-900 bg-white focus:outline-none focus:border-neutral-900"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-neutral-900 text-white text-sm hover:bg-neutral-700 transition-colors disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add user"}
          </button>
          {saved && <span className="text-sm text-neutral-500">Added.</span>}
        </div>
      </form>
    </section>
  );
}

function UserTable({
  users,
  currentUserEmail,
  onDeleted,
}: {
  users: User[];
  currentUserEmail: string;
  onDeleted: (email: string) => void;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<string | null>(null);
  const isLastUser = users.length <= 1;

  async function handleDelete(email: string) {
    setPending(email);
    setErrors((prev) => ({ ...prev, [email]: "" }));
    const result = await deleteAdminUser({ email });
    setPending(null);
    if (result.success) {
      onDeleted(email);
    } else {
      setErrors((prev) => ({ ...prev, [email]: result.error }));
    }
  }

  return (
    <section>
      <h2 className="text-sm font-medium text-neutral-900 mb-4">All users</h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-neutral-500 border-b border-neutral-200 [color-scheme:light]">
            <th className="pb-2 font-normal">Email</th>
            <th className="pb-2 font-normal">Created</th>
            <th className="pb-2 font-normal">Last sign-in</th>
            <th className="pb-2 font-normal"></th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => {
            const isSelf = u.email === currentUserEmail;
            const canDelete = !isSelf && !isLastUser;
            return (
              <tr key={u.email} className="border-b border-neutral-100">
                <td className="py-2 pr-4 text-neutral-900">
                  {u.email}
                  {isSelf && <span className="ml-2 text-xs text-neutral-400">(you)</span>}
                </td>
                <td className="py-2 pr-4 text-neutral-500">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="py-2 pr-4 text-neutral-500">
                  {u.lastSignInAt ? new Date(u.lastSignInAt).toLocaleDateString() : "—"}
                </td>
                <td className="py-2">
                  {!isSelf && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDelete(u.email)}
                        disabled={!canDelete || pending === u.email}
                        title={isLastUser ? "Cannot delete the last user" : undefined}
                        className="text-xs text-neutral-500 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        {pending === u.email ? "Deleting…" : "Delete"}
                      </button>
                      {errors[u.email] && (
                        <span className="text-xs text-red-600">{errors[u.email]}</span>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
