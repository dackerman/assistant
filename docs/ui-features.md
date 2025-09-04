## Capabilities

The interface kinda looks like chatgpt or librechat, but:

- you can run arbitrary bash scripts on the server
- you can read and write anywhere in the filesystem
- you can even run sudo commands - i guess it implements a SUDO_ASKPASS executable that basically passes it down to the client?
- i guess you can enable/disable specific capabilities for a given chat if you want, but also it kinda figures out which tools it should use on its own

## Conversations

I do want to have a more sophisticated way of managing past conversations. just a giant list is super annoying.

Maybe I want to organize them into folders? or tag conversations? really a past conversation is two things:

1. context so that the AI knows what you were doing at that time and you don't have to re-explain yourself
2. reference material (e.g. AI told me how to cook a steak and I want to come back to it later)

but i feel like a whole conversation thread generally takes up a ton of context that is unnecessary. i want tools for taking a conversation and splitting it up in to concepts / outcomes so that they can be individually loaded into future converstations. and in a new converstaion you can mix and match them. maybe have the LLM query for them itself. kinda like a memory feature but maybe more powerful.

really i think conversations should just be like files on the filesystem that can be queried, indexed, modified like in a database. so they are no different than any other inputs that the LLM can look up. that way, it can coalese and consolidate into other purpose-made files, and then load them up individually in the future.

maybe you should be able to browse and view all these files - and conversations are just another file. like the view you see as a user is actually a filesystem and there's just a `conversations/` directory that has them all. you can edit/delete them as needed. and other folders and files can also be added.

### Context management

As above, I think a "conversation" is just more context to have in the window. For now, managing what's in context is very important for effective prompting and getting things done. As a power user, you should be able to manage the context of the LLM explicitly. Like, tweak the system prompt, pull in bits of knowledge and skills, either from the web or from past conversations (all with the help of the LLM!). I guess I need to figure out how different this should be from literally "write X to file Y", and later "load file Y". It would be nice to have a better affordance than that.

## Tools

- Any bash commands the server can run, including ones it writes itself
- Read/Write access to the computer
- Ability to run sudo and have the user type the password for approval
- some pre-built explicit tools attached to the AI as needed, like
  - asana
  - google calendar
  - gmail
  - form-mcp

Additionally, some useful information is automatically provided into the context of each conversation, like

- the current date and time for the user, and timezone (sent from client)
- the current location of the user, if available
