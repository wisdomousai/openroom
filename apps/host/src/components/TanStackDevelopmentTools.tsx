import { TanStackDevtools } from '@tanstack/react-devtools';
import { ReactQueryDevtoolsPanel } from '@tanstack/react-query-devtools';
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools';

import { router } from '../app-router';

export default function TanStackDevelopmentTools() {
  return (
    <TanStackDevtools
      plugins={[
        { id: 'query', name: 'TanStack Query', render: <ReactQueryDevtoolsPanel /> },
        { id: 'router', name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel router={router} /> },
      ]}
    />
  );
}
