import type { Aggregate, InteractionView } from '@openroom/sdk';
import { AggregateChart } from '@openroom/charts';
import { useBump } from '../hooks';
import { AnimatedNumber, Frame } from './common';

interface Props {
  interaction: InteractionView;
  aggregate: Aggregate | null;
  revealed: boolean;
  frozen: boolean;
  reduced: boolean;
  answeredCount: number;
  /** Peer instruction: round-1 tally, non-null only once revealed. */
  round1Aggregate?: Aggregate | null;
  interactionStatus?: 'pending' | 'open' | 'closed' | 'revealed' | null;
  round?: 1 | 2 | null;
}

/**
 * Hidden-until-reveal: prompt plus a live answer counter and nothing else.
 */
export function PendingCounter({ answeredCount, reduced }: { answeredCount: number; reduced?: boolean }) {
  const bump = useBump(answeredCount) && !reduced;
  return (
    <Frame
      summary={`Results hidden. ${answeredCount} answer${
        answeredCount === 1 ? '' : 's'
      } so far.`}
    >
      <div className={`pending${bump ? ' pending--bump' : ''}`}>
        <AnimatedNumber value={answeredCount} className="pending__value" />
        <span className="pending__label" aria-hidden="true">
          {answeredCount === 1 ? 'answer so far' : 'answers so far'}
        </span>
      </div>
    </Frame>
  );
}

export function DiscussPrompt({ answeredCount }: { answeredCount: number }) {
  return (
    <Frame
      summary={`Discussion. ${answeredCount} answer${
        answeredCount === 1 ? '' : 's'
      }. Results hidden.`}
    >
      <div className="discuss">
        <p className="discuss__title">Discuss</p>
        <p className="discuss__body">Find someone who picked a different answer. Compare reasons.</p>
        <p className="discuss__meta">
          {answeredCount} answer{answeredCount === 1 ? '' : 's'} so far · results hidden
        </p>
      </div>
    </Frame>
  );
}

export function Visualization(p: Props) {
  const { interaction, aggregate, revealed, frozen, reduced, answeredCount } = p;
  const round1 = p.round1Aggregate ?? null;
  const peer =
    interaction.type === 'choice' &&
    (interaction as { peerInstruction?: boolean }).peerInstruction === true;
  const round = p.round ?? 1;
  const closed = p.interactionStatus === 'closed';

  if (!aggregate) {
    if (peer && closed && round === 1) {
      return <DiscussPrompt answeredCount={answeredCount} />;
    }
    return <PendingCounter answeredCount={answeredCount} reduced={reduced} />;
  }

  return (
    <AggregateChart
      interaction={interaction}
      aggregate={aggregate}
      revealed={revealed}
      frozen={frozen}
      reduced={reduced}
      size="stage"
      round1Aggregate={round1}
    />
  );
}
