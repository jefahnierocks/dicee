#!/usr/bin/env bun
/**
 * AKG MCP Server Test Harness
 *
 * Tests all 7 MCP tools via JSON-RPC over stdio.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id: number;
	method: string;
	params?: Record<string, unknown>;
}

interface JsonRpcResponse {
	jsonrpc: '2.0';
	id: number;
	result?: unknown;
	error?: { code: number; message: string };
}

const { log, error: logError } = console;

class McpTestClient {
	private process: ReturnType<typeof spawn>;
	private requestId = 0;
	private pendingRequests = new Map<number, (response: JsonRpcResponse) => void>();
	private readline: ReturnType<typeof createInterface>;
	private ready = false;

	constructor() {
		this.process = spawn('bun', ['run', './packages/web/src/tools/akg/mcp/server.ts'], {
			stdio: ['pipe', 'pipe', 'pipe'],
			cwd: process.cwd(),
			env: {
				...process.env,
				AKG_GRAPH_PATH: './docs/architecture/akg/graph/current.json',
			},
		});

		const stdout = this.process.stdout;
		if (!stdout) throw new Error('Failed to get stdout from process');
		this.readline = createInterface({ input: stdout });

		this.readline.on('line', (line) => {
			try {
				const response = JSON.parse(line) as JsonRpcResponse;
				const resolver = this.pendingRequests.get(response.id);
				if (resolver) {
					resolver(response);
					this.pendingRequests.delete(response.id);
				}
			} catch {
				// Ignore non-JSON lines (stderr messages)
			}
		});

		this.process.stderr?.on('data', (data) => {
			const msg = data.toString().trim();
			if (msg.includes('Server running')) {
				this.ready = true;
			}
		});
	}

	async waitReady(timeoutMs = 5000): Promise<void> {
		const start = Date.now();
		while (!this.ready && Date.now() - start < timeoutMs) {
			await new Promise((r) => setTimeout(r, 100));
		}
		if (!this.ready) {
			throw new Error('Server did not become ready');
		}
		// Give it a moment to fully initialize
		await new Promise((r) => setTimeout(r, 500));
	}

	async initialize(): Promise<JsonRpcResponse> {
		return this.send('initialize', {
			protocolVersion: '2024-11-05',
			capabilities: {},
			clientInfo: { name: 'test-client', version: '1.0.0' },
		});
	}

	async callTool(name: string, args: Record<string, unknown> = {}): Promise<JsonRpcResponse> {
		return this.send('tools/call', { name, arguments: args });
	}

	async listTools(): Promise<JsonRpcResponse> {
		return this.send('tools/list', {});
	}

	private send(method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
		return new Promise((resolve, reject) => {
			const id = ++this.requestId;
			const request: JsonRpcRequest = {
				jsonrpc: '2.0',
				id,
				method,
				params,
			};

			this.pendingRequests.set(id, resolve);

			const timeoutId = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`Request ${method} timed out`));
			}, 10000);

			this.process.stdin?.write(`${JSON.stringify(request)}\n`);

			// Clear timeout on resolve
			const originalResolve = this.pendingRequests.get(id);
			if (originalResolve) {
				this.pendingRequests.set(id, (response) => {
					clearTimeout(timeoutId);
					originalResolve(response);
				});
			}
		});
	}

	close(): void {
		this.process.kill();
	}
}

interface TestResult {
	tool: string;
	passed: boolean;
	duration: number;
	details: string;
	error?: string;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Test harness runs many sequential tests
async function runTests(): Promise<void> {
	log('\n╔══════════════════════════════════════════════════════════════╗');
	log('║              AKG MCP SERVER TEST SUITE                       ║');
	log('╚══════════════════════════════════════════════════════════════╝\n');

	const client = new McpTestClient();
	const results: TestResult[] = [];

	try {
		log('Starting server...');
		await client.waitReady();
		log('✓ Server ready\n');

		// Initialize
		log('Initializing MCP connection...');
		const initResponse = await client.initialize();
		if (initResponse.error) {
			throw new Error(`Initialize failed: ${initResponse.error.message}`);
		}
		log('✓ MCP initialized\n');

		// List tools
		log('Listing available tools...');
		const toolsResponse = await client.listTools();
		if (toolsResponse.error) {
			throw new Error(`List tools failed: ${toolsResponse.error.message}`);
		}
		const tools = (toolsResponse.result as { tools: Array<{ name: string }> }).tools;
		log(`✓ Found ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);

		// Test 1: akg_layer_rules
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 1: akg_layer_rules                                     │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start1 = Date.now();
		try {
			const response = await client.callTool('akg_layer_rules', { layer: 'components' });
			const duration = Date.now() - start1;
			if (response.error) {
				results.push({
					tool: 'akg_layer_rules',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed = data.layer === 'components' && Array.isArray(data.mayImport);
				results.push({
					tool: 'akg_layer_rules',
					passed,
					duration,
					details: `Layer: ${data.layer}, mayImport: ${data.mayImport?.length || 0} layers`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid response structure`);
				log(`  Layer: ${data.layer}`);
				log(`  May import: ${(data.mayImport || []).join(', ') || 'none'}`);
				log(`  May not import: ${(data.mayNotImport || []).join(', ') || 'none'}`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_layer_rules',
				passed: false,
				duration: Date.now() - start1,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 2: akg_node_info
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 2: akg_node_info                                       │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start2 = Date.now();
		try {
			const response = await client.callTool('akg_node_info', {
				filePath: 'packages/web/src/lib/engine.ts',
			});
			const duration = Date.now() - start2;
			if (response.error) {
				results.push({
					tool: 'akg_node_info',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed = Boolean(data.id && data.type && data.filePath);
				results.push({
					tool: 'akg_node_info',
					passed,
					duration,
					details: `Node: ${data.name}, Type: ${data.type}, Imports: ${data.imports?.length || 0}`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid response structure`);
				log(`  Node: ${data.name}`);
				log(`  Type: ${data.type}`);
				log(`  Layer: ${data.layer || 'none'}`);
				log(
					`  Imports: ${data.imports?.length || 0}, Imported by: ${data.importedBy?.length || 0}`,
				);
			}
		} catch (e) {
			results.push({
				tool: 'akg_node_info',
				passed: false,
				duration: Date.now() - start2,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 3: akg_check_import (allowed)
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 3: akg_check_import (allowed import)                   │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start3 = Date.now();
		try {
			const response = await client.callTool('akg_check_import', {
				fromPath: 'packages/web/src/lib/components/dice/Die.svelte',
				toPath: 'packages/web/src/lib/types.ts',
			});
			const duration = Date.now() - start3;
			if (response.error) {
				results.push({
					tool: 'akg_check_import',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed =
					data.allowed === true && data.fromLayer === 'components' && data.toLayer === 'types';
				results.push({
					tool: 'akg_check_import',
					passed,
					duration,
					details: `Allowed: ${data.allowed}, Reason: ${data.reason}`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid response structure`);
				log(`  Allowed: ${data.allowed}`);
				log(`  Reason: ${data.reason}`);
				log(`  From layer: ${data.fromLayer || 'N/A'}, To layer: ${data.toLayer || 'N/A'}`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_check_import',
				passed: false,
				duration: Date.now() - start3,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 4: akg_invariant_status
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 4: akg_invariant_status                                │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start4 = Date.now();
		try {
			const response = await client.callTool('akg_invariant_status', {});
			const duration = Date.now() - start4;
			if (response.error) {
				results.push({
					tool: 'akg_invariant_status',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed = typeof data.passed === 'number' && typeof data.failed === 'number';
				results.push({
					tool: 'akg_invariant_status',
					passed,
					duration,
					details: `Passed: ${data.passed}/${data.total}, Errors: ${data.errors}, Warnings: ${data.warnings}`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid response structure`);
				log(`  Total: ${data.total} invariants`);
				log(`  Passed: ${data.passed}, Failed: ${data.failed}`);
				log(`  Errors: ${data.errors}, Warnings: ${data.warnings}`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_invariant_status',
				passed: false,
				duration: Date.now() - start4,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 5: akg_diagram
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 5: akg_diagram                                         │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start5 = Date.now();
		try {
			const response = await client.callTool('akg_diagram', { name: 'layer-overview' });
			const duration = Date.now() - start5;
			if (response.error) {
				results.push({
					tool: 'akg_diagram',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const passed = content.includes('```mermaid') && content.includes('flowchart');
				const lineCount = content.split('\n').length;
				results.push({
					tool: 'akg_diagram',
					passed,
					duration,
					details: `Generated ${lineCount} lines of Mermaid`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid mermaid output`);
				log(`  Generated ${lineCount} lines of Mermaid diagram`);
				log(`  Type: layer-overview`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_diagram',
				passed: false,
				duration: Date.now() - start5,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 6: akg_path_find (no path)
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 6: akg_path_find (no path expected)                    │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start6 = Date.now();
		try {
			const response = await client.callTool('akg_path_find', {
				from: 'packages/web/src/lib/utils/index.ts',
				to: 'packages/web/src/lib/engine.ts',
			});
			const duration = Date.now() - start6;
			if (response.error) {
				results.push({
					tool: 'akg_path_find',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed = typeof data.found === 'boolean';
				results.push({
					tool: 'akg_path_find',
					passed,
					duration,
					details: data.found
						? `Found path with ${data.pathLength} nodes`
						: 'No path found (expected)',
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid response structure`);
				log(`  Path found: ${data.found}`);
				if (data.found && data.path) {
					log(`  Path length: ${data.pathLength}`);
					log(`  Path: ${data.path.map((n: { name: string }) => n.name).join(' → ')}`);
				} else {
					log(`  Reason: ${data.reason || 'N/A'}`);
				}
			}
		} catch (e) {
			results.push({
				tool: 'akg_path_find',
				passed: false,
				duration: Date.now() - start6,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 7: akg_layer_rules (invalid layer)
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 7: akg_layer_rules (invalid layer - error case)        │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start7 = Date.now();
		try {
			const response = await client.callTool('akg_layer_rules', { layer: 'nonexistent' });
			const duration = Date.now() - start7;
			if (response.error) {
				results.push({
					tool: 'akg_layer_rules (error)',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const passed = content.includes('not found') && content.includes('Available layers');
				results.push({
					tool: 'akg_layer_rules (error)',
					passed,
					duration,
					details: passed ? 'Correctly returned error message' : 'Unexpected response',
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Expected error message`);
				log(`  Response: ${content.slice(0, 80)}...`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_layer_rules (error)',
				passed: false,
				duration: Date.now() - start7,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 8: akg_diagram (all types)
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 8: akg_diagram (all diagram types)                     │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start8 = Date.now();
		const diagramTypes = [
			'layer-overview',
			'component-dependencies',
			'store-relationships',
			'dataflow',
		];
		let allDiagramsPassed = true;
		for (const diagramType of diagramTypes) {
			try {
				const response = await client.callTool('akg_diagram', { name: diagramType });
				if (response.error) {
					log(`  ✗ ${diagramType}: ${response.error.message}`);
					allDiagramsPassed = false;
				} else {
					const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
					if (content.includes('```mermaid') && content.includes('flowchart')) {
						const lineCount = content.split('\n').length;
						log(`  ✓ ${diagramType}: ${lineCount} lines`);
					} else {
						log(`  ✗ ${diagramType}: Invalid mermaid output`);
						allDiagramsPassed = false;
					}
				}
			} catch (e) {
				log(`  ✗ ${diagramType}: ${e}`);
				allDiagramsPassed = false;
			}
		}
		const duration8 = Date.now() - start8;
		results.push({
			tool: 'akg_diagram (all types)',
			passed: allDiagramsPassed,
			duration: duration8,
			details: allDiagramsPassed ? 'All 4 diagram types generated' : 'Some diagrams failed',
		});
		log(allDiagramsPassed ? `✓ All passed (${duration8}ms)` : `✗ Some failed`);
		log('');

		// Test 9: akg_invariant_status (single invariant)
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 9: akg_invariant_status (single invariant)             │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start9 = Date.now();
		try {
			const response = await client.callTool('akg_invariant_status', {
				invariantId: 'wasm_single_entry',
			});
			const duration = Date.now() - start9;
			if (response.error) {
				results.push({
					tool: 'akg_invariant_status (single)',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed = data.invariantId === 'wasm_single_entry' && typeof data.passed === 'boolean';
				results.push({
					tool: 'akg_invariant_status (single)',
					passed,
					duration,
					details: `Invariant: ${data.invariantId}, Passed: ${data.passed}`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Invalid response structure`);
				log(`  Invariant: ${data.invariantId}`);
				log(`  Passed: ${data.passed}`);
				log(`  Violations: ${data.violationCount}`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_invariant_status (single)',
				passed: false,
				duration: Date.now() - start9,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Test 10: akg_node_info (by nodeId)
		log('┌──────────────────────────────────────────────────────────────┐');
		log('│ Test 10: akg_node_info (by nodeId)                          │');
		log('└──────────────────────────────────────────────────────────────┘');
		const start10 = Date.now();
		try {
			// First get a valid node ID
			const nodeInfoResponse = await client.callTool('akg_node_info', {
				filePath: 'packages/web/src/lib/engine.ts',
			});
			const nodeContent = (nodeInfoResponse.result as { content: Array<{ text: string }> })
				.content[0].text;
			const nodeData = JSON.parse(nodeContent);
			const nodeId = nodeData.id;

			const response = await client.callTool('akg_node_info', { nodeId });
			const duration = Date.now() - start10;
			if (response.error) {
				results.push({
					tool: 'akg_node_info (by id)',
					passed: false,
					duration,
					details: '',
					error: response.error.message,
				});
				log(`✗ Failed: ${response.error.message}`);
			} else {
				const content = (response.result as { content: Array<{ text: string }> }).content[0].text;
				const data = JSON.parse(content);
				const passed = data.id === nodeId;
				results.push({
					tool: 'akg_node_info (by id)',
					passed,
					duration,
					details: `Found node: ${data.name}`,
				});
				log(passed ? `✓ Passed (${duration}ms)` : `✗ Failed: Node ID mismatch`);
				log(`  Node ID: ${data.id}`);
				log(`  Name: ${data.name}`);
			}
		} catch (e) {
			results.push({
				tool: 'akg_node_info (by id)',
				passed: false,
				duration: Date.now() - start10,
				details: '',
				error: String(e),
			});
			log(`✗ Error: ${e}`);
		}
		log('');

		// Summary
		log('══════════════════════════════════════════════════════════════');
		const passed = results.filter((r) => r.passed).length;
		const failed = results.filter((r) => !r.passed).length;
		const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

		if (failed === 0) {
			log('\x1b[32m');
			log('  ██████╗  █████╗ ███████╗███████╗███████╗██████╗ ');
			log('  ██╔══██╗██╔══██╗██╔════╝██╔════╝██╔════╝██╔══██╗');
			log('  ██████╔╝███████║███████╗███████╗█████╗  ██║  ██║');
			log('  ██╔═══╝ ██╔══██║╚════██║╚════██║██╔══╝  ██║  ██║');
			log('  ██║     ██║  ██║███████║███████║███████╗██████╔╝');
			log('  ╚═╝     ╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝╚═════╝ ');
			log('\x1b[0m');
		} else {
			log('\x1b[31m');
			log('  ███████╗ █████╗ ██╗██╗     ███████╗██████╗ ');
			log('  ██╔════╝██╔══██╗██║██║     ██╔════╝██╔══██╗');
			log('  █████╗  ███████║██║██║     █████╗  ██║  ██║');
			log('  ██╔══╝  ██╔══██║██║██║     ██╔══╝  ██║  ██║');
			log('  ██║     ██║  ██║██║███████╗███████╗██████╔╝');
			log('  ╚═╝     ╚═╝  ╚═╝╚═╝╚══════╝╚══════╝╚═════╝ ');
			log('\x1b[0m');
		}

		log('');
		log(`  Results: ${passed}/${results.length} tests passed`);
		log(`  Total time: ${totalDuration}ms`);
		log('');

		// Output JSON summary
		log('JSON Summary:');
		log(
			JSON.stringify(
				{
					passed,
					failed,
					total: results.length,
					totalDurationMs: totalDuration,
					results: results.map((r) => ({
						tool: r.tool,
						passed: r.passed,
						durationMs: r.duration,
						details: r.details,
						error: r.error,
					})),
				},
				null,
				2,
			),
		);

		process.exit(failed > 0 ? 1 : 0);
	} catch (error) {
		logError(`Fatal error: ${error}`);
		process.exit(1);
	} finally {
		client.close();
	}
}

runTests();
