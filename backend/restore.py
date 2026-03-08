import requests
import json

with open("/Users/helix/gitrepo/doco/exports/啊；i产/粘贴 markdown.md", "r") as f:
    markdown = f.read()

resp = requests.put(
    "http://localhost:8000/api/docs/doc_uuznv34h0/markdown",
    json={"markdown": markdown}
)

print(resp.status_code)
print(resp.json())
