export type ArtworkStatus = "live" | "draft" | "hidden" | "deleted";

export type ArtworkReference = {
  caption: string;
  url?: string;
  image?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageFilename?: string;
};

export type Artwork = {
  id: number;
  slug: string;
  title: string;
  year: number;
  medium: string;
  dimensions?: string;
  description?: string;
  blobId: string;
  image: string;
  originalImage?: string;
  imageFilename?: string;
  width: number;
  height: number;

  tagIds: string[];
  status: ArtworkStatus;
  orderByTag: Record<string, number>;
  orderGlobal: number;
  reference?: ArtworkReference;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type Tag = {
  id: string;
  title: string;
  note?: string;
  order: number;
  visible: boolean;
  isPrimaryRoom: boolean;
  createdAt: string;
  updatedAt: string;
};

export type User = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  lastSignInAt?: string;
};

export type Session = {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  userAgent?: string;
  ip?: string;
};

export type AboutContent = {
  bio: string;
  email: string;
  updatedAt: string;
};

export type AuditAction =
  | "artwork.create"
  | "artwork.update"
  | "artwork.delete"
  | "artwork.restore"
  | "artwork.purge"
  | "tag.create"
  | "tag.update"
  | "tag.delete"
  | "about.update"
  | "user.create"
  | "user.delete"
  | "auth.sign-in"
  | "auth.sign-out"
  | "auth.failed";

export type AuditEntry = {
  id: string;
  at: string;
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  target?: string;
  diff?: Record<string, { from: unknown; to: unknown }>;
  ip?: string;
};
