import chalk from 'chalk';
import { Command } from 'commander';
import { createGranolaDebug } from '../../lib/debug.js';
import { toMarkdown } from '../../lib/prosemirror.js';
import { toToon } from '../../lib/toon.js';
import * as meetings from '../../services/meetings.js';

const debug = createGranolaDebug('cmd:meeting:export');

type ExportFormat = 'json' | 'toon';

/**
 * Creates the 'export' command for exporting complete meeting data.
 *
 * Exports meeting metadata, notes (as Markdown and raw), and transcript.
 * Supports JSON and TOON (token-optimized) output formats.
 *
 * @returns Commander command instance
 */
export function createExportCommand() {
  return new Command('export')
    .description('Export meeting data')
    .argument('<id>', 'Meeting ID')
    .option('-f, --format <format>', 'Output format (json, toon)', 'json')
    .action(async (id: string, options: { format: string }) => {
      debug('export command invoked with id: %s, format: %s', id, options.format);
      const format = options.format as ExportFormat;
      if (format !== 'json' && format !== 'toon') {
        console.error(chalk.red(`Invalid format: ${options.format}. Use 'json' or 'toon'.`));
        process.exit(1);
      }

      let fullId: string;
      try {
        const resolved = await meetings.resolveId(id);
        if (!resolved) {
          console.error(chalk.red(`Meeting ${id} not found`));
          process.exit(4);
        }
        fullId = resolved;
      } catch (err) {
        console.error(chalk.red((err as Error).message));
        process.exit(1);
      }

      const [meeting, notes, transcript] = await Promise.all([
        meetings.get(fullId),
        meetings.getNotes(fullId),
        meetings.getTranscript(fullId),
      ]);

      if (!meeting) {
        console.error(chalk.red(`Meeting ${id} not found`));
        process.exit(4);
      }

      const output = {
        id: meeting.id,
        title: meeting.title,
        created_at: meeting.created_at,
        updated_at: meeting.updated_at,
        workspace_id: meeting.workspace_id,
        people:
          meeting.people ??
          (meeting.creator || meeting.attendees
            ? {
                creator: meeting.creator,
                attendees: meeting.attendees,
              }
            : undefined),
        notes_markdown: notes ? toMarkdown(notes) : null,
        notes_raw: notes,
        transcript,
      };

      if (format === 'toon') {
        console.log(toToon(output));
      } else {
        console.log(JSON.stringify(output, null, 2));
      }
    });
}

export const exportCommand = createExportCommand();
