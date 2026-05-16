"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { COLORS } from "@/lib/constants";
import { formatDate, formatDuration, getLangName } from "@/lib/utils";
import { Icon } from "@/components/shared/icon";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { PromptDialog } from "@/components/shared/prompt-dialog";
import type { StoredSession } from "@/hooks/use-sessions";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface SessionCardProps {
  session: StoredSession;
}

export function SessionCard({ session }: SessionCardProps) {
  const updateTitle = useMutation(api.sessions.updateTitle);
  const deleteSession = useMutation(api.sessions.deleteSession);

  const [hoverRename, setHoverRename] = useState(false);
  const [hoverDelete, setHoverDelete] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const title = session.title ?? "Untitled session";
  const hasSummary = Boolean(session.summary);

  const openRename = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setRenameOpen(true);
  };

  const openDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteOpen(true);
  };

  const handleRenameSave = async (next: string) => {
    if (next === session.title) return;
    await updateTitle({
      sessionId: session._id as Id<"sessions">,
      title: next,
    });
  };

  const handleDeleteConfirm = async () => {
    await deleteSession({ sessionId: session._id as Id<"sessions"> });
  };

  return (
    <div
      className="w-full flex items-stretch rounded-[20px] mb-[10px] overflow-hidden"
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
      }}
    >
      <Link
        href={`/session/${session._id}`}
        className="flex-1 flex items-start gap-3 px-5 py-4 min-w-0 cursor-pointer transition-colors"
      >
        <div
          className="w-10 h-10 rounded-2xl grid place-items-center flex-shrink-0 mt-[2px]"
          style={{
            background: COLORS.surfaceLight,
            border: `1px solid ${COLORS.borderLight}`,
          }}
        >
          <Icon name="doc" size={16} color={COLORS.t3} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div
              className="text-[14px] font-semibold truncate"
              style={{ color: COLORS.w }}
            >
              {title}
            </div>
            {hasSummary && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-[6px] py-[2px] rounded-md flex-shrink-0"
                style={{
                  background: COLORS.accentSoft,
                  color: COLORS.accent,
                }}
              >
                ✦ Summary
              </span>
            )}
          </div>
          <div
            className="text-[11px] flex items-center gap-2"
            style={{ color: COLORS.t4 }}
          >
            <span>{getLangName(session.sourceLanguage)}</span>
            <span>→</span>
            <span>{getLangName(session.targetLanguage)}</span>
            <span>·</span>
            <span>{formatDate(session.createdAt)}</span>
            <span>·</span>
            <span className="tabular-nums">
              {formatDuration(session.duration)}
            </span>
          </div>
        </div>
      </Link>

      <div className="flex items-center gap-0.5 pr-2 flex-shrink-0">
        <button
          type="button"
          onClick={openRename}
          onMouseEnter={() => setHoverRename(true)}
          onMouseLeave={() => setHoverRename(false)}
          aria-label="Rename session"
          className="w-9 h-9 rounded-lg grid place-items-center transition-colors"
          style={{
            background: hoverRename ? COLORS.surfaceLight : "transparent",
            color: hoverRename ? COLORS.w : COLORS.t3,
          }}
        >
          <Icon name="edit" size={16} color="currentColor" />
        </button>
        <button
          type="button"
          onClick={openDelete}
          onMouseEnter={() => setHoverDelete(true)}
          onMouseLeave={() => setHoverDelete(false)}
          aria-label="Delete session"
          className="w-9 h-9 rounded-lg grid place-items-center transition-colors"
          style={{
            background: hoverDelete ? COLORS.redSoft : "transparent",
            color: hoverDelete ? COLORS.red : COLORS.t3,
          }}
        >
          <Icon name="trash" size={16} color="currentColor" />
        </button>
      </div>

      <PromptDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename session"
        label="Session name"
        placeholder="e.g. Friday khutbah, March 14"
        defaultValue={session.title ?? ""}
        onSave={handleRenameSave}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this session?"
        message="The transcript and summary will be permanently removed. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDeleteConfirm}
      />
    </div>
  );
}
