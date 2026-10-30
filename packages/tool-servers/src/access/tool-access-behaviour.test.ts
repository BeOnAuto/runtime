import { connectionBehaviour } from '../access-testing/connection-behaviour.ts';
import { apiUnderTest, mcpUnderTest, serversUnderTest } from '../access-testing/servers-under-test.ts';
import { throughAConnection, throughTheFile } from '../access-testing/sources-under-test.ts';
import { toolAccessBehaviour } from '../access-testing/tool-access-behaviour.ts';

for (const underTest of serversUnderTest) {
  toolAccessBehaviour(underTest, throughTheFile);
  toolAccessBehaviour(underTest, throughAConnection);
}
connectionBehaviour(mcpUnderTest);
connectionBehaviour(apiUnderTest);
