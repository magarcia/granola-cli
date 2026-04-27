import chalk from 'chalk';
import { Command } from 'commander';
import { createGranolaDebug } from '../../lib/debug.js';
import { formatOutput, type OutputFormat } from '../../lib/output.js';
import { pipeToPager } from '../../lib/pager.js';
import { toMarkdown } from '../../lib/prosemirror.js';
import * as meetings from '../../services/meetings.js';
import type { ProseMirrorDoc } from '../../types.js';

const debug = createGranolaDebug('cmd:meeting:enhanced');

/**
 * Creates the 'enhanced' command for displaying AI-enhanced meeting notes.
 *
 * Retrieves and renders AI-generated meeting summaries as Markdown.
 * Uses a pager for long output in interactive terminals.
 * Supports -o/--output for raw ProseMirror JSON output.
 *
 * @returns Commander command instance
 */
export function createEnhancedCommand() {
  return new Command('enhanced')
    .description('View AI-enhanced meeting notes')
    .argument('<id>', 'Meeting ID')
    .option('-o, --output <format>', 'Output format (markdown, json, yaml, toon)', 'markdown')
    .action(async (id: string, opts, cmd) => {
      debug('enhanced command invoked with id: %s', id);
      const global = cmd.optsWithGlobals();

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

      let notes: ProseMirrorDoc | string | null;
      try {
        notes = await meetings.getEnhancedNotes(fullId);
      } catch (error) {
        debug('failed to load enhanced notes: %O', error);
        console.error(chalk.red('Error:'), 'Failed to fetch enhanced notes.');
        if (error instanceof Error) {
          console.error(chalk.dim(error.message));
        }
        process.exit(1);
      }

      if (!notes) {
        console.error(chalk.red(`No enhanced notes found for meeting ${id}`));
        process.exit(4);
      }

      const format = opts.output || 'markdown';
      const structuredFormats: OutputFormat[] = ['json', 'yaml', 'toon'];
      if (format !== 'markdown' && !structuredFormats.includes(format as OutputFormat)) {
        console.error(
          chalk.red(`Invalid format: ${format}. Use 'markdown', 'json', 'yaml', or 'toon'.`),
        );
        process.exit(1);
      }

      if (structuredFormats.includes(format as OutputFormat)) {
        console.log(formatOutput(notes, format as OutputFormat));
        return;
      }

      const md = toMarkdown(notes);

      if (global.noPager || !process.stdout.isTTY) {
        console.log(md);
      } else {
        await pipeToPager(md);
      }
    });
}

export const enhancedCommand = createEnhancedCommand();
