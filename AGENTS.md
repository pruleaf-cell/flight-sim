# AGENTS.md

## Project mission
Build an ambitious but shippable static browser flight simulator with a strong take-off and landing loop.

This project should feel like a serious desktop browser simulation prototype, not an arcade toy and not an unfinished engine experiment.

## Product priorities
Priority order:
1. believable take-off and landing
2. coherent and readable flight handling
3. cockpit/instrument usability
4. polished user flow
5. scoring / evaluation
6. environment and presentation polish
7. extra features

## Engineering constraints
- Prefer vanilla HTML, CSS, and JavaScript
- Use Canvas and/or WebGL only as needed
- No backend
- No server requirement
- Avoid heavy frameworks
- Avoid unnecessary dependencies
- Keep setup minimal
- Keep files and modules understandable
- Project should run locally and be suitable for GitHub Pages

## Scope rules
Push ambition hard, but do not leave the project half-finished.

If realism features become too complex, simplify in this order:
- cut extra cameras before cutting landing quality
- cut extra scenery before cutting core flight feel
- cut extra modes before cutting cockpit readability
- cut secondary systems before cutting scoring and replay loop

Never sacrifice the core loop:
start -> control aircraft -> take off -> fly -> land -> receive result -> restart

## Delivery workflow
- Use branch: feat/browser-flight-sim
- Build end-to-end autonomously
- Add/update README
- Push the branch
- Open a PR

## README requirements
README must include:
- project overview
- how to run locally
- controls
- simulation model summary
- scoring/evaluation explanation
- architecture overview
- deployment notes for GitHub Pages
- known limitations
- sensible future improvements

## PR requirements
PR description must include:
- summary
- features built
- technical choices
- tradeoffs
- manual testing steps
- known limitations

## Quality bar
Do not leave placeholder buttons, broken menus, fake instrumentation, or decorative systems with no gameplay value.

A smaller polished sim is better than a larger messy one.

## User experience
The sim must make controls and goals understandable from inside the app.
Include:
- title/start screen
- controls/help
- pause/settings
- clear restart flow
- visible outcome for landing/crash/success

## Testing bar
Before finalising, verify:
- controls work
- aircraft can take off
- aircraft can stall or mishandle in a believable way if pushed badly
- landing can succeed or fail
- scoring/result appears
- restart works
- settings persist if implemented
