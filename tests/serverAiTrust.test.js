const test = require("node:test");
const assert = require("node:assert/strict");

const serverHelpers = require("../server.js");

test("trusted advisor fallback upgrades plain validation input into structured engineering guidance", function () {
  const advisor = serverHelpers.buildTrustedLocalAdvisor({
    validation: {
      status: "NON_COMPLIANT",
      summary: "Outdoor air is below the design minimum.",
      confidenceScore: 0.88,
      findings: [
        {
          severity: "critical",
          category: "ventilation",
          title: "Outdoor air is below the design minimum",
          detail: "Provided outdoor air is 180 CFM against a required minimum of 320 CFM.",
          recommendation: "Increase outdoor air before finalizing equipment sizing.",
          basis: "Minimum ventilation compliance check."
        }
      ]
    }
  });

  assert.equal(advisor.provider, "local_reasoning");
  assert.match(advisor.summary, /outdoor air/i);
  assert.ok(Array.isArray(advisor.items) && advisor.items.length > 0);
  assert.ok(advisor.items.every(function (item) {
    return item.complianceStatus === "NON_COMPLIANT";
  }));
});

test("engineering reconciliation keeps AI alternatives aligned with compliance priority", function () {
  const trusted = serverHelpers.buildTrustedLocalAlternatives({
    validation: {
      status: "REVIEW",
      summary: "The design is under review.",
      confidenceScore: 0.82,
      findings: []
    },
    localAlternatives: {
      provider: "local_optimization",
      summary: "Simulation-backed options are ready.",
      preferredOptionKey: "invalid_choice",
      options: [
        {
          key: "invalid_choice",
          title: "Invalid option",
          systemType: "DOAS + recirculation",
          complianceStatus: "NON_COMPLIANT",
          decisionScore: 95,
          simulationBacked: true
        },
        {
          key: "balanced_option",
          title: "Balanced option",
          systemType: "Low-static central airside system",
          complianceStatus: "COMPLIANT",
          decisionScore: 82,
          simulationBacked: true
        }
      ]
    }
  });

  const reconciled = serverHelpers.reconcileAlternativesWithEngineering({
    preferredOptionKey: "invalid_choice",
    options: [
      {
        key: "invalid_choice",
        title: "Invalid option",
        systemType: "DOAS + recirculation",
        complianceStatus: "NON_COMPLIANT",
        decisionScore: 95,
        simulationBacked: true
      },
      {
        key: "balanced_option",
        title: "Balanced option",
        systemType: "Low-static central airside system",
        complianceStatus: "COMPLIANT",
        decisionScore: 82,
        simulationBacked: true
      }
    ]
  }, trusted, {
    status: "REVIEW",
    confidenceScore: 0.82
  });

  assert.equal(reconciled.preferredOptionKey, "balanced_option");
  assert.equal(reconciled.options[0].key, "balanced_option");
});
