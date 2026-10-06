import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  LogOut,
  Palette,
  Smartphone,
  Snowflake,
} from 'lucide-react';

import { useEditorServices, type LibraryPlace } from '../services';
import { Button } from '@openroom/ui/components/button';
import { SessionFullNotice } from './SessionFullNotice';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@openroom/ui/components/dropdown-menu';
import { Hint } from '@openroom/ui/components/tooltip';
import type { ConnectionStatus } from '../types';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connecting: 'Connecting',
  live: 'Live',
  polling: 'Polling',
  offline: 'Offline',
};

const STATUS_DOT: Record<ConnectionStatus, string> = {
  connecting: 'bg-live',
  live: 'bg-live',
  polling: 'bg-live',
  offline: 'bg-destructive',
};

export interface HostHeaderProps {
  status: ConnectionStatus;
  code: string;
  /** An identified tutoring session shows the learner, never a join code. */
  showCode: boolean;
  learnerName?: string | null;
  sessionTitle: string;
  joined: number;
  /** Most participants the session admits; absent when unlimited. */
  participantLimit?: number;
  /** Space owner or editor: may follow the full-session notice to Plans. */
  canManagePlan?: boolean;
  answered: number;
  groupAnswers?: boolean;
  frozen: boolean;
  ended: boolean;
  canPresent: boolean;
  onToggleFreeze: () => void;
  onEndSession: () => void;
  joinUrl: string;
  onCopyJoin: () => void;
  sessionCode: string;
  hostToken: string;
  stageToken: string | null;
  onStageRetry: () => void;
  hasQna: boolean;
  activeThemeName: string;
  onOpenTheme: () => void;
  onExport: (format: 'csv' | 'json' | 'ballots') => void;
  /** `null` until the desktop shell answers; hides the exit destination. */
  documentWindow: boolean | null;
  /** The deck's place in the Library, so leaving mid-session keeps the folder. */
  libraryPlace?: LibraryPlace | null;
  onBackToDeck: () => void;
  onReturnToDeck?: () => void;
  push: (message: string, tone?: 'info' | 'warn' | 'error') => void;
}

export function HostHeader({
  status,
  code,
  showCode,
  learnerName,
  sessionTitle,
  joined,
  participantLimit,
  canManagePlan = false,
  answered,
  groupAnswers,
  frozen,
  ended,
  canPresent,
  onToggleFreeze,
  onEndSession,
  joinUrl,
  onCopyJoin,
  sessionCode,
  hostToken,
  stageToken,
  onStageRetry,
  hasQna,
  activeThemeName,
  onOpenTheme,
  onExport,
  documentWindow,
  libraryPlace = null,
  onBackToDeck,
  onReturnToDeck,
  push,
}: HostHeaderProps) {
  const services = useEditorServices();
  const { navigate, shareUrl } = services.navigation;
  const remoteLink = shareUrl('remote', sessionCode, hostToken);
  const qnaLink = hasQna ? shareUrl('qna', sessionCode, hostToken) : null;

  return (
    <header className="flex h-11 shrink-0 items-center gap-3.5 bg-chrome px-4" data-theme-surface="">
      {onReturnToDeck ? <Button variant="subtle" size="sm" onClick={onReturnToDeck}>Edit deck</Button> : null}
      <span className="inline-flex items-center gap-2 text-title-bar">
        <span className={STATUS_DOT[status]} aria-hidden="true" />
        {STATUS_LABEL[status]}
      </span>
      {showCode ? (
        <Hint label="Copy the participant join link">
          <button
            type="button"
            onClick={onCopyJoin}
            title="Tap to copy"
            aria-label={`Join code ${code}. Copy join link.`}
            className="inline-flex h-[26px] items-center rounded-full bg-live-tint px-2.5 text-sm font-semibold tracking-[0.08em] text-live-tint-foreground tabular-nums"
          >
            {code}
          </button>
        </Hint>
      ) : (
        <span className="text-sm font-semibold">{learnerName ?? 'Session'}</span>
      )}
      {sessionTitle ? <span className="text-sm text-muted-foreground">{sessionTitle}</span> : null}
      <span className="flex-1" />
      <span className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
        <strong className="font-semibold text-foreground">{joined}</strong> joined ·{' '}
        <strong className="font-semibold text-foreground">{answered}</strong> {groupAnswers ? (answered === 1 ? 'group answer' : 'group answers') : 'answered'}
      </span>
      <SessionFullNotice joined={joined} limit={participantLimit} canManagePlan={canManagePlan} />
      <Button type="button" variant="subtle" size="sm" disabled={ended || !canPresent} onClick={onToggleFreeze}>
        {frozen ? 'Unfreeze' : 'Freeze'}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={ended || !canPresent} onClick={onEndSession}>
        End session
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon" aria-label="Session menu">
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{showCode ? `Session ${code}` : sessionTitle || 'Session'}</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href={joinUrl} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              Join page
            </a>
          </DropdownMenuItem>
          {stageToken ? (
            <DropdownMenuItem asChild>
              <a href={services.live.stageUrl(sessionCode, stageToken)} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                Stage
              </a>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={onStageRetry}>
              <ExternalLink aria-hidden="true" />
              Stage — retry
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onSelect={() => {
              navigate({ kind: 'sessionRemote', sessionCode });
            }}
          >
            <Smartphone aria-hidden="true" />
            Remote
          </DropdownMenuItem>
          {remoteLink === null ? null : (
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(remoteLink).then(
                  () => push('Remote link copied'),
                  () => push('Could not copy link', 'error'),
                );
              }}
            >
              <Copy aria-hidden="true" />
              Copy remote link
            </DropdownMenuItem>
          )}
          {hasQna ? (
            <DropdownMenuItem
              onSelect={() => {
                navigate({ kind: 'sessionQna', sessionCode });
              }}
            >
              <ExternalLink aria-hidden="true" />
              Q&A desk
            </DropdownMenuItem>
          ) : null}
          {qnaLink !== null ? (
            <DropdownMenuItem
              onSelect={() => {
                void navigator.clipboard.writeText(qnaLink).then(
                  () => push('Link copied'),
                  () => push('Could not copy link', 'error'),
                );
              }}
            >
              <Copy aria-hidden="true" />
              Copy Q&A desk link
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onOpenTheme}>
            <Palette aria-hidden="true" />
            Theme: {activeThemeName}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={ended || !canPresent} onSelect={onToggleFreeze}>
            <Snowflake aria-hidden="true" />
            {frozen ? 'Unfreeze' : 'Freeze'}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => { navigate({ kind: 'sessionRecap', sessionCode }); }}>
            <Download aria-hidden="true" />
            Prepare workshop recap
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport('json')}>
            <Download aria-hidden="true" />
            Download JSON
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport('csv')}>
            <Download aria-hidden="true" />
            Download counts (CSV)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onExport('ballots')}>
            <Download aria-hidden="true" />
            Download responses (CSV)
          </DropdownMenuItem>
          {documentWindow === null ? null : !documentWindow ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ kind: 'library', place: libraryPlace })}>
                <LogOut aria-hidden="true" />
                Library
              </DropdownMenuItem>
            </>
          ) : (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onBackToDeck}>
                <LogOut aria-hidden="true" />
                Back to deck
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
