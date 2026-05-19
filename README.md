# hvac-load-calculator

## AI Design Suggestions

The calculator now has two AI-assisted layers:

- A built-in design advisor that turns warnings into specific corrective actions.
- A separate AI Design Studio page that compares cost-effective, balanced, and efficiency-first alternative concepts.
- Local rule-based guidance and alternatives always work after each calculation.
- Optional OpenAI enhancement upgrades both the advisor and the alternative-design page.

## ISO Cleanroom Mode

The input page now includes a cleanroom design basis:

- Switch `Design Basis` to `ISO cleanroom`.
- Select the cleanroom class target (`ISO 9` to `ISO 5`).
- Select `Operational` or `At-rest`.
- Choose `Positive`, `Neutral`, or `Negative` pressure regime.

In cleanroom mode, the airflow engine stops treating the room like a normal comfort-only space and instead sizes the conditioned recirculation airflow from the selected ISO-class template. The AI Design Studio page also changes its concepts to cleanroom-specific alternatives.

Important: ISO 14644 class is particle-count based. The app uses HVAC sizing templates for airflow, filtration, and pressure as an early design basis; final certification still requires particle counts, HEPA integrity testing, balancing, and pressure qualification.

### Backend setup

Create a `.env` file in the project root and add:

```env
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-5.4-mini
```

`OPENAI_MODEL` is optional. If omitted, the backend uses `gpt-5.4-mini`.

### How it behaves

- Without `OPENAI_API_KEY`: the app uses local engineering rules and local alternative concepts only.
- With `OPENAI_API_KEY`: the app first shows local guidance, then automatically enhances:
  - `/api/ai/design-advisor`
  - `/api/ai/design-alternatives`
- If an AI request fails, the UI falls back to the local result and shows the failure state.

### Run

```sh
npm start
```
