#!/usr/bin/env bash
set -e
port="${1:?the port of this computer to publish the container on}"
image="${2:?the image to run}"
. "$(dirname "${BASH_SOURCE[0]}")/calls.sh"
container="$(smoke_name mcp)"
show_logs_on_failure "$container"
issued="$(runtime_command node packages/identity/src/key-command.ts --org demo)"
key="$(printf '%s\n' "$issued" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$key"
reading="$(runtime_command node packages/identity/src/key-command.ts --org demo --permissions org:read,playbook:read)"
read_key="$(printf '%s\n' "$reading" | sed --quiet 's/^API key, shown only this once: //p')"
echo "::add-mask::$read_key"
API_KEYS="[$(printf '%s\n' "$issued" | sed --quiet 's/^API_KEYS entry: //p'),$(printf '%s\n' "$reading" | sed --quiet 's/^API_KEYS entry: //p')]"
export API_KEYS
runtime_start "$container" "" DO_NOT_TRACK=1 API_KEYS
for attempt in $(seq 1 30); do
  curl --silent --fail http://127.0.0.1:$port/health > /dev/null && break
  sleep 1
done
call_mcp_as() {
  test "$(answered "$4" --header "authorization: Bearer $1" \
    --header 'content-type: application/json' --header 'accept: application/json, text/event-stream' \
    --header 'mcp-protocol-version: 2025-11-25' --data "$3" "http://127.0.0.1:$port$2")" = 200
}
call_mcp() {
  call_mcp_as "$key" "$1" "$2" "$3"
}
call_mcp /orgs/demo/mcp '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' tools.txt
for tool in create_playbook list_playbooks update_playbook retire_playbook restore_playbook add_connection list_connections remove_connection; do
  grep --quiet "\"name\":\"$tool\"" tools.txt
done
call_mcp /orgs/demo/mcp '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_playbook","arguments":{"playbook":"smoke","name":"Smoke test"}}}' created.txt
grep --quiet '"structuredContent":{"id":"smoke","name":"Smoke test"' created.txt
call_mcp /orgs/demo/mcp '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_playbooks","arguments":{}}}' listed.txt
grep --quiet '"id":"smoke","name":"Smoke test"' listed.txt
test "$(answered read.json --header "authorization: Bearer $key" http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke)" = 200
grep --quiet '"id":"smoke","name":"Smoke test"' read.json
call_mcp /mcp '{"jsonrpc":"2.0","id":4,"method":"tools/list"}' all-tools.txt
test "$(grep --only-matching '"name":"[a-z_]*","title"' all-tools.txt | wc -l)" -eq 40
for tool in list_models list_runs get_event list_playbook_events publish_event search introspect dry_run query_connection execute_connection list_connection_tools list_interactions answer_interaction get_asset send_run_event cancel_run get_guide; do
  grep --quiet "\"name\":\"$tool\"" all-tools.txt
done
call_mcp /mcp '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_definitions","arguments":{"playbook":"smoke","type":"reasoning"}}}' definitions.txt
grep --quiet '"structuredContent":{"definitions":\[\]}' definitions.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"list_runs","arguments":{"playbook":"smoke"}}}' runs.txt
grep --quiet '"structuredContent":{"runs":\[\],"has_more":false,"next_cursor":null}' runs.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"search","arguments":{"playbook":"smoke"}}}' tool-servers.txt
grep --quiet '"structuredContent":{"servers":\[\],"tools":\[\],"scopes":\[\]}' tool-servers.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"search","arguments":{}}}' org-tool-servers.txt
grep --quiet '"structuredContent":{"servers":\[\],"tools":\[\],"scopes":\[\]}' org-tool-servers.txt
test "$(answered org-servers.json --header "authorization: Bearer $read_key" http://127.0.0.1:$port/v1/orgs/demo/tool-servers/search)" = 200
test "$(cat org-servers.json)" = '{"servers":[],"tools":[],"scopes":[]}'
call_mcp /mcp '{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"execute_connection","arguments":{"playbook":"smoke","server":"graph","tool":"search"}}}' executed.txt
grep --quiet '"isError":true' executed.txt
grep --quiet 'tool_server_not_configured' executed.txt
call_mcp_as "$read_key" /mcp '{"jsonrpc":"2.0","id":14,"method":"tools/list"}' read-tools.txt
grep --quiet '"name":"search"' read-tools.txt
grep --quiet '"name":"dry_run"' read-tools.txt
test "$(grep --count '"name":"execute_connection"' read-tools.txt)" = 0
test "$(grep --count '"name":"query_connection"' read-tools.txt)" = 0
test "$(answered refused.json \
  --header "authorization: Bearer $read_key" --header 'content-type: application/json' --data '{"arguments":{}}' \
  http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke/tool-servers/graph/tools/search/execute)" = 403
grep --quiet '"reason":"forbidden"' refused.json
for read in validate dry-run; do
  test "$(answered "$read.json" \
    --header "authorization: Bearer $read_key" --header 'content-type: application/json' --data '{"arguments":{}}' \
    "http://127.0.0.1:$port/v1/orgs/demo/playbooks/smoke/tool-servers/graph/tools/search/$read")" = 503
  grep --quiet '"reason":"unavailable"' "$read.json"
  grep --quiet '"because":"tool_server_not_configured"' "$read.json"
done
call_mcp_as "$read_key" /mcp '{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"introspect","arguments":{"playbook":"smoke","server":"graph","tool":"search"}}}' introspected.txt
grep --quiet '"isError":true' introspected.txt
grep --quiet 'tool_server_not_configured' introspected.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":8,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"ci","version":"1"}}}' initialized.txt
grep --quiet 'Studio manages them; the agent is a separate client' initialized.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_guide","arguments":{"guide":"reasoning-function"}}}' guide.txt
grep --quiet '# Reasoning function format' guide.txt
grep --quiet 'On this server, ' guide.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":10,"method":"resources/list"}' resources.txt
test "$(grep --only-matching '"uri":"guide://[a-z-]*"' resources.txt | wc -l)" -eq 17
grep --quiet '"uri":"guide://lookup-function"' resources.txt
call_mcp /directory '{"jsonrpc":"2.0","id":23,"method":"tools/list"}' directory-tools.txt
test "$(grep --only-matching '"name":"[a-z_]*","title"' directory-tools.txt | wc -l)" -eq 39
test "$(grep --count 'generation' directory-tools.txt)" = 0
test "$(grep --count '"name":"get_asset"' directory-tools.txt)" = 0
call_mcp /directory '{"jsonrpc":"2.0","id":24,"method":"resources/list"}' directory-resources.txt
test "$(grep --only-matching '"uri":"guide://[a-z-]*"' directory-resources.txt | wc -l)" -eq 16
test "$(grep --count 'guide://generation-function' directory-resources.txt)" = 0
call_mcp /mcp '{"jsonrpc":"2.0","id":11,"method":"prompts/list"}' prompts.txt
for prompt in first-playbook connect-a-service give-tools schedule keep; do
  grep --quiet "\"name\":\"$prompt\"" prompts.txt
done
call_mcp /mcp '{"jsonrpc":"2.0","id":21,"method":"tools/call","params":{"name":"list_comments","arguments":{}}}' org-comments.txt
grep --quiet '"structuredContent":{"comments":\[\],"has_more":false,"next_cursor":null}' org-comments.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":22,"method":"tools/call","params":{"name":"list_comments","arguments":{"playbook":"smoke"}}}' playbook-comments.txt
grep --quiet '"structuredContent":{"comments":\[\],"has_more":false,"next_cursor":null}' playbook-comments.txt
call_mcp /mcp '{"jsonrpc":"2.0","id":12,"method":"prompts/get","params":{"name":"first-playbook"}}' first-playbook.txt
grep --quiet 'Create my first playbook.' first-playbook.txt
runtime_stop "$container"
