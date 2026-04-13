function joinSentenceList(items = []) {
  return items.filter(Boolean).join("; ");
}

function safeText(value) {
  return String(value || "").trim();
}

function humanizeDecisionValue(value) {
  return safeText(value).replaceAll("_", " ");
}

export function compilerResultToMarkdown(result) {
  if (!result) return "";

  const parts = [
    "## Recommended persona",
    "",
    `**Base persona:** ${safeText(result.persona)}`,
    "",
    `**Refined persona:** *${safeText(result.refined)}*`,
  ];

  if (safeText(result.style_summary)) {
    parts.push("", "## Style interpretation", "", safeText(result.style_summary));
  }

  parts.push("", "## Why this fits", "", safeText(result.why));

  if (result.context_risk || Array.isArray(result.missing_context)) {
    parts.push("", "## Context sensitivity", "");

    if (result.context_risk) {
      parts.push(`- **Context risk:** ${safeText(result.context_risk)}`);
    }

    if (Array.isArray(result.missing_context) && result.missing_context.length > 0) {
      parts.push("- **Missing context:**");
      result.missing_context.forEach((item) => {
        parts.push(`  - ${safeText(item)}`);
      });
    } else {
      parts.push("- **Missing context:** none identified");
    }
  }

  if (result.decision_type || result.decision_source || result.decision_note) {
    parts.push(
      "",
      "## Decision transparency",
      "",
      `- **Decision type:** ${humanizeDecisionValue(result.decision_type)}`,
      `- **Decision source:** ${humanizeDecisionValue(result.decision_source)}`,
      `- **Decision note:** ${safeText(result.decision_note)}`
    );
  }

  parts.push("", "## Ready-to-use prompt", "", safeText(result.full_prompt));

  return parts.join("\n");
}

export function lensResultToMarkdown(result) {
  if (!result) return "";

  if (result.result_type === "summary") {
    return [
      "## Applied lens",
      "",
      safeText(result.lens_application),
      "",
      "## Summary",
      "",
      safeText(result.summary),
    ].join("\n");
  }

  const optionBlocks = (result.options || []).flatMap((option, index) => [
    `### ${index + 1}. ${safeText(option.label)}`,
    "",
    safeText(option.application),
    "",
  ]);

  return [
    "## Calibration needed",
    "",
    "The lens combination could be applied in more than one materially different way. Choose one text-bound application.",
    "",
    ...optionBlocks,
  ].join("\n");
}

export function structuredResultToMarkdown(result, bulletSummary = true) {
  if (!result) return "";

  const parts = [];

  if (result.topics_ideas) {
    parts.push("## Topics / Ideas", "");

    if (bulletSummary) {
      result.topics_ideas.items.forEach((item, index) => {
        parts.push(`${index + 1}. **${safeText(item.topic)}** — ${safeText(item.explanation)}`);
      });
    } else {
      result.topics_ideas.items.forEach((item, index) => {
        parts.push(`${index + 1}. **${safeText(item.topic)}.** ${safeText(item.explanation)}`);
      });
    }

    parts.push("");
  }

  if (result.claims) {
    parts.push("## Claims", "", `**Central claim:** ${safeText(result.claims.central_claim)}`, "");

    if (bulletSummary) {
      parts.push("### Supporting claims", "");
      result.claims.supporting_claims.forEach((item) => {
        parts.push(`- ${safeText(item)}`);
      });
      parts.push("", "### Implied assumptions", "");
      result.claims.implied_assumptions.forEach((item) => {
        parts.push(`- ${safeText(item)}`);
      });
    } else {
      parts.push(`**Supporting claims:** ${joinSentenceList(result.claims.supporting_claims)}.`, "");
      parts.push(`**Implied assumptions:** ${joinSentenceList(result.claims.implied_assumptions)}.`);
    }

    parts.push("");
  }

  if (result.framework) {
    parts.push("## Framework", "");

    if (bulletSummary) {
      parts.push("### Key concepts", "");
      result.framework.key_concepts.forEach((item) => {
        parts.push(`- **${safeText(item.term)}** — ${safeText(item.role)}`);
      });
      parts.push("", "### Relations", "");
      result.framework.relations.forEach((item) => {
        parts.push(`- ${safeText(item)}`);
      });
      parts.push("", `**Governing framework:** ${safeText(result.framework.governing_framework)}`);
    } else {
      const concepts = (result.framework.key_concepts || [])
        .map((item) => `**${safeText(item.term)}** functions as ${safeText(item.role)}`)
        .join("; ");
      const relations = joinSentenceList(result.framework.relations);

      parts.push(`**Key concepts:** ${concepts}.`, "");
      parts.push(`**Relations:** ${relations}.`, "");
      parts.push(`**Governing framework:** ${safeText(result.framework.governing_framework)}`);
    }

    parts.push("");
  }

  if (result.reverse_outline) {
    parts.push("## Reverse Outline", "");

    result.reverse_outline.units.forEach((unit, index) => {
      parts.push(`### ${index + 1}. ${safeText(unit.label)}`, "");

      if (bulletSummary) {
        parts.push(`- **Function:** ${safeText(unit.function)}`);
        parts.push(`- **Main move:** ${safeText(unit.main_move)}`);
        parts.push(`- **Supporting move:** ${safeText(unit.supporting_move)}`);
        parts.push(`- **Relation to overall argument:** ${safeText(unit.relation_to_overall_argument)}`);
      } else {
        parts.push(
          `**Function:** ${safeText(unit.function)}  \n**Main move:** ${safeText(unit.main_move)}  \n**Supporting move:** ${safeText(unit.supporting_move)}  \n**Relation to overall argument:** ${safeText(unit.relation_to_overall_argument)}`
        );
      }

      parts.push("");
    });

    if (bulletSummary) {
      parts.push("### Structural diagnosis", "");
      result.reverse_outline.structural_diagnosis.forEach((item) => {
        parts.push(`- ${safeText(item)}`);
      });
    } else {
      parts.push(
        "### Structural diagnosis",
        "",
        `${(result.reverse_outline.structural_diagnosis || []).map((item) => `- ${safeText(item)}`).join("\n")}`
      );
    }

    parts.push("");
  }

  return parts.join("\n").trim();
}

export function draftResultToMarkdown(result) {
  if (!result) return "";

  if (result.needs_clarification) {
    const questions = (result.questions || []).map((item, index) => `${index + 1}. ${safeText(item)}`);
    return [
      "## Clarification needed",
      "",
      "The draft is waiting on a small clarification before prose can be generated.",
      "",
      ...questions,
    ].join("\n");
  }

  const parts = ["## Draft", "", safeText(result.draft)];

  if (Array.isArray(result.notes) && result.notes.length > 0) {
    parts.push("", "## Notes", "");
    result.notes.forEach((item) => {
      parts.push(`- ${safeText(item)}`);
    });
  }

  return parts.join("\n").trim();
}
