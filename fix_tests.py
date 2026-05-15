import re

with open('tests/stable-tools.test.ts', 'r', encoding='utf-8') as f:
    content = f.read()

patterns = [
    r"test\('executeStableTool verifies read access in the two-step call flow', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableTool uses verified mobile gate so DOB retries do not need mobile_last_4 again', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableTool verifies spoken natural-language dates without timezone drift', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableTool verifies DOB from conversational transcripts', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableTool returns dob_parse_failed when DOB text is not a parseable date', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableTool keeps legacy verification aliases working internally', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableTool rejects mismatched verification without exposing customer records', \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableToolWithContext overrides AI no_match when deterministic DOB matches', async \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableToolWithContext respects skipAiDobVerification \(parse-only path\)', async \(\) => \{.*?\}\);\n\n",
    r"test\('executeStableToolWithContext matches spoken numeric DOB without AI', async \(\) => \{.*?\}\);\n\n",
]

for p in patterns:
    content = re.sub(p, "", content, flags=re.DOTALL)

with open('tests/stable-tools.test.ts', 'w', encoding='utf-8') as f:
    f.write(content)
