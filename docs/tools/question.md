# question

Opens the interactive question overlay to collect structured user input.

## Parameters

- context (optional): Short reason shown in the header
- questions (required): Up to 3 topics with options

## Usage

- Use this instead of plain-text questions
- Provide concise labels and clear descriptions
- **Free-text answers:** every topic includes a built-in **"Type your own answer"** row (last option). The user can enter `owner/repo`, a full URL, or any custom text — do not add a dummy option like "I will tell you later" that forces a second message.

## Example: ambiguous GitHub repo

When issue #N could refer to an unknown repository:

- **topic:** Repository
- **question:** Which GitHub repo does issue #N refer to?
- **options:** one label for the detected workspace repo (e.g. `This repo (owner/name)`), optional second concrete choice if known
- User can select an option or use **Type your own answer** for `other-org/other-repo` or `https://github.com/.../issues/N`
